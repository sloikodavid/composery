import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import * as express from "express"
import { wss, Router as WsRouter, type WebsocketRequest } from "../../wsRouter"
import { authenticate } from "./auth"
import { apiConfig } from "./config"
import { nodePty } from "./pty"
import { sessions } from "./ratelimit"

export const wsRouter = WsRouter()
export const httpRouter = express.Router()

const TMUX_COMMAND_TIMEOUT_MS = 5000
const SESSION_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/

function endWithStatus(req: WebsocketRequest, status: number, message: string): void {
  req.ws.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`)
}

function clampDim(value: string | number | null | undefined, fallback: number): number {
  const n = Math.floor(Number(value))
  return n >= 1 && n <= 1000 ? n : fallback
}

function validSessionName(name: string | undefined): name is string {
  return typeof name === "string" && SESSION_NAME_PATTERN.test(name)
}

function stopChild(child: ChildProcessWithoutNullStreams): void {
  try {
    child.kill("SIGTERM")
  } catch {}
}

wsRouter.ws("/v1/exec", async (req: WebsocketRequest) => {
  const auth = await authenticate(req)
  if (!auth.id) {
    endWithStatus(req, auth.status ?? 401, auth.message ?? "Unauthorized")
    return
  }
  const keyId = auth.id
  const url = new URL(req.url || "/", "http://localhost")
  const rawSessionName = url.searchParams.has("session")
    ? url.searchParams.get("session") || undefined
    : undefined
  if (rawSessionName !== undefined && !validSessionName(rawSessionName)) {
    endWithStatus(req, 400, "Invalid Session")
    return
  }

  if (!sessions.tryAcquire(keyId)) {
    endWithStatus(req, 429, "Too Many Sessions")
    return
  }
  let released = false
  const release = () => {
    if (released) return
    released = true
    sessions.release(keyId)
  }

  const cols = clampDim(url.searchParams.get("cols"), 80)
  const rows = clampDim(url.searchParams.get("rows"), 24)
  const sessionName = rawSessionName
  const cmd = url.searchParams.get("cmd") || undefined

  let file: string
  let args: string[]
  if (sessionName) {
    file = "tmux"
    args = ["new-session", "-A", "-s", sessionName]
    if (cmd) args.push(cmd)
  } else {
    file = apiConfig.shell
    args = cmd ? ["-l", "-c", cmd] : ["-l"]
  }

  let term: any
  let termExited = false
  const stopTerm = () => {
    release()
    if (!term || termExited) return
    termExited = true
    try {
      term.kill()
    } catch {}
  }
  try {
    term = nodePty().spawn(file, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: apiConfig.home || process.cwd(),
      env: process.env,
    })
  } catch {
    release()
    endWithStatus(req, 500, "Terminal unavailable")
    return
  }

  req.ws.once("close", stopTerm)
  req.ws.once("error", stopTerm)

  try {
    wss.handleUpgrade(req, req.ws, req.head, (ws) => {
      term.onData((data: string) => {
        try {
          ws.send(Buffer.from(data, "utf8"))
        } catch {}
      })
      term.onExit(({ exitCode }: { exitCode: number }) => {
        termExited = true
        release()
        try {
          ws.send(JSON.stringify({ exit: { code: exitCode } }))
          ws.close()
        } catch {}
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
            term.resize(clampDim(message.resize.cols, cols), clampDim(message.resize.rows, rows))
          } else if (message.input != null) {
            term.write(String(message.input))
          }
        } catch {
          term.write(text)
        }
      })

      ws.on("close", () => {
        stopTerm()
      })

      req.ws.resume()
    })
  } catch {
    stopTerm()
    try {
      endWithStatus(req, 500, "Terminal unavailable")
    } catch {}
  }
})

httpRouter.get("/sessions", (_req, res) => {
  const child = spawn("tmux", [
    "ls",
    "-F",
    "#{session_name}\t#{session_created}\t#{session_attached}",
  ])
  let out = ""
  let settled = false
  let timeout: ReturnType<typeof setTimeout>
  const send = (payload: unknown) => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    res.json(payload)
  }
  timeout = setTimeout(() => {
    stopChild(child)
    send({ sessions: [] })
  }, TMUX_COMMAND_TIMEOUT_MS)
  res.on("close", () => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    stopChild(child)
  })
  child.stdout.on("data", (chunk) => (out += chunk))
  child.on("error", () => send({ sessions: [] }))
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
    send({ sessions: list })
  })
})

httpRouter.delete("/sessions/:name", (req, res) => {
  const name = req.params.name
  if (!validSessionName(name)) {
    res.status(400).json({ message: "invalid session name" })
    return
  }

  const child = spawn("tmux", ["kill-session", "-t", name])
  let settled = false
  let timeout: ReturnType<typeof setTimeout>
  const send = (status: number, payload: unknown) => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    res.status(status).json(payload)
  }
  timeout = setTimeout(() => {
    stopChild(child)
    send(504, { message: "tmux timed out" })
  }, TMUX_COMMAND_TIMEOUT_MS)
  res.on("close", () => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    stopChild(child)
  })
  child.on("error", () => send(500, { message: "tmux unavailable" }))
  child.on("close", (code) => send(200, { killed: code === 0, name }))
})
