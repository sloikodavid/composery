import { spawn } from "child_process"
import * as express from "express"
import { wss, Router as WsRouter, type WebsocketRequest } from "../../wsRouter"
import { authenticate } from "./auth"
import { apiConfig } from "./config"
import { nodePty } from "./pty"
import { sessions } from "./ratelimit"

// Mode 2: interactive terminal over a websocket (real PTY: stdin, live output,
// resize). No timeout, no output cap. With ?session=<name> it is tmux-backed and
// survives disconnect + a code-server restart (detached); without it, the shell
// dies on disconnect (ephemeral).
//
// Framing: binary ws messages are raw PTY I/O both ways; text ws messages are
// JSON control - currently {"resize":{"cols":N,"rows":N}}.

export const wsRouter = WsRouter()
export const httpRouter = express.Router()

function endWithStatus(req: WebsocketRequest, status: number, message: string): void {
  req.ws.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`)
}

wsRouter.ws("/v1/exec", async (req: WebsocketRequest) => {
  const auth = await authenticate(req)
  if (!auth.id) {
    endWithStatus(req, auth.status ?? 401, auth.message ?? "Unauthorized")
    return
  }
  const keyId = auth.id
  if (!sessions.tryAcquire(keyId)) {
    endWithStatus(req, 429, "Too Many Sessions")
    return
  }

  const url = new URL(req.url || "/", "http://localhost")
  const cols = parseInt(url.searchParams.get("cols") || "80", 10) || 80
  const rows = parseInt(url.searchParams.get("rows") || "24", 10) || 24
  const sessionName = url.searchParams.get("session") || undefined
  const cmd = url.searchParams.get("cmd") || undefined

  let file: string
  let args: string[]
  if (sessionName) {
    // tmux owns the session lifetime; -A attaches or creates.
    file = "tmux"
    args = ["new-session", "-A", "-s", sessionName]
    if (cmd) args.push(cmd)
  } else {
    file = apiConfig.shell
    args = cmd ? ["-l", "-c", cmd] : ["-l"]
  }

  let term: any
  try {
    term = nodePty().spawn(file, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: apiConfig.home || process.cwd(),
      env: process.env,
    })
  } catch {
    sessions.release(keyId)
    endWithStatus(req, 500, "Terminal unavailable")
    return
  }

  wss.handleUpgrade(req, req.ws, req.head, (ws) => {
    let released = false
    const release = () => {
      if (released) return
      released = true
      sessions.release(keyId)
    }

    term.onData((data: string) => {
      try {
        ws.send(Buffer.from(data, "utf8"))
      } catch {
        /* socket closing */
      }
    })
    term.onExit(({ exitCode }: { exitCode: number }) => {
      try {
        ws.send(JSON.stringify({ exit: { code: exitCode } }))
        ws.close()
      } catch {
        /* already closed */
      }
    })

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        term.write(data.toString("utf8"))
        return
      }
      const text = data.toString("utf8")
      try {
        const message = JSON.parse(text)
        if (message.resize) {
          term.resize(Number(message.resize.cols) || cols, Number(message.resize.rows) || rows)
        } else if (message.input != null) {
          term.write(String(message.input))
        }
      } catch {
        // Not JSON control - treat as input.
        term.write(text)
      }
    })

    ws.on("close", () => {
      release()
      // Ephemeral: kills the shell. Detached: kills only our tmux attach client;
      // the tmux server keeps the session alive for reattach.
      try {
        term.kill()
      } catch {
        /* already exited */
      }
    })

    req.ws.resume()
  })
})

// List and kill detached (tmux) sessions.
httpRouter.get("/sessions", (_req, res) => {
  const child = spawn("tmux", [
    "ls",
    "-F",
    "#{session_name}\t#{session_created}\t#{session_attached}",
  ])
  let out = ""
  child.stdout.on("data", (chunk) => (out += chunk))
  child.on("error", () => res.json({ sessions: [] }))
  child.on("close", () => {
    const list = out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, created, attached] = line.split("\t")
        return {
          name,
          created_at: Number(created) || 0,
          attached: attached !== "0" && attached !== undefined,
        }
      })
    res.json({ sessions: list })
  })
})

httpRouter.delete("/sessions/:name", (req, res) => {
  const child = spawn("tmux", ["kill-session", "-t", req.params.name])
  child.on("error", () => res.status(500).json({ message: "tmux unavailable" }))
  child.on("close", (code) => res.json({ killed: code === 0, name: req.params.name }))
})
