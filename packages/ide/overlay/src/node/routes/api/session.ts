import { logger } from "@coder/logger"
import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import * as crypto from "crypto"
import * as express from "express"
import { wss, Router as WsRouter, type WebsocketRequest } from "../../wsRouter"
import { authenticate } from "./auth"
import { apiConfig } from "./config"
import { apiBasePath } from "./constants"
import { nodePty } from "./pty"
import { sessions } from "./ratelimit"

export const wsRouter = WsRouter()
export const httpRouter = express.Router()

const TMUX_COMMAND_TIMEOUT_MS = 5000
const SESSION_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/
// tmux user option carrying what this session was started to run. It is both
// the editor's tab title and its marker for "the API made this", so a session a
// user started by hand with `tmux` is left alone. Read back as
// `#{@composery_cmd}`; keep in sync with the composery-api extension.
const SESSION_LABEL = "@composery_cmd"
// Mirrors VS Code's ShutdownConstants.DataFlushTimeout (terminalProcess.ts).
// node-pty's onExit can fire while reads are still pending
// (microsoft/node-pty#72), so hold the exit frame until output goes quiet or
// the tail of a command's output is lost.
const DATA_FLUSH_TIMEOUT_MS = 250
// Above this much unsent output queued on the socket, pause the pty until the
// client drains - otherwise a fast-spewing command with a slow client grows
// the Node heap without bound.
const MAX_WS_BUFFERED_BYTES = 4 * 1024 * 1024

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

// tmux target-session falls back to prefix and fnmatch matching; a leading `=`
// forces an exact match. Without it `kill-session -t build` stops `build-2`.
function target(name: string): string {
  return `=${name}`
}

// set-option takes a *pane* target, whose parser rejects a bare `=name` - the
// trailing `:` makes it a session-qualified pane target, which accepts `=` and
// is exact. Verified on tmux 3.3a: `set-option -t build` writes into `build-2`,
// `set-option -t =build:` refuses. Anything that reaches for a session here has
// to go through this, or the anchoring is silently lost.
function paneTarget(name: string): string {
  return `=${name}:`
}

function stopChild(child: ChildProcessWithoutNullStreams): void {
  try {
    child.kill("SIGTERM")
  } catch {}
}

function tmux(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("tmux", args)
    let settled = false
    const settle = (code: number) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(code)
    }
    const timeout = setTimeout(() => {
      stopChild(child)
      settle(-1)
    }, TMUX_COMMAND_TIMEOUT_MS)
    child.on("error", () => settle(-1))
    child.on("close", (code) => settle(code ?? -1))
  })
}

wsRouter.ws(`${apiBasePath}/exec`, async (req: WebsocketRequest) => {
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
  const cmd = url.searchParams.get("cmd") || undefined
  // Every API terminal is a tmux session so the editor can attach to the same
  // pty rather than to a parallel one. Without ?session= the name is ours and
  // dies with the socket, which keeps the documented ephemeral behaviour.
  const persistent = rawSessionName !== undefined
  const sessionName = rawSessionName ?? `api-${crypto.randomBytes(4).toString("hex")}`

  // Create detached, label, then attach - rather than `new-session -A`, which
  // attaches to an existing name and silently drops cmd. It also means the API
  // client and the editor run the identical attach command, and the label is in
  // place before the editor can list the session.
  const exists = (await tmux(["has-session", "-t", target(sessionName)])) === 0
  if (exists && cmd) {
    release()
    endWithStatus(req, 409, "Session Exists")
    return
  }
  if (!exists) {
    const create = ["new-session", "-d", "-s", sessionName]
    // Same login shell the one-shot /exec uses; tmux runs its own default-shell
    // as a login shell when no command is given.
    if (cmd) create.push(apiConfig.shell, "-l", "-c", cmd)
    if ((await tmux(create)) !== 0) {
      release()
      endWithStatus(req, 500, "Terminal unavailable")
      return
    }
    // The editor titles the terminal tab from this and lists only sessions that
    // carry it. A session that fails to get one still works perfectly over the
    // websocket - it is just invisible in the editor, so say so rather than let
    // the whole feature look merely empty.
    const labelled = await tmux([
      "set-option",
      "-t",
      paneTarget(sessionName),
      SESSION_LABEL,
      cmd || apiConfig.shell,
    ])
    if (labelled !== 0) {
      logger.warn(
        `could not label tmux session ${sessionName}; it will not be listed in the editor`,
      )
    }
  }

  let term: any
  let termExited = false
  const stopTerm = () => {
    release()
    if (!persistent) void tmux(["kill-session", "-t", target(sessionName)])
    if (!term || termExited) return
    termExited = true
    try {
      term.kill()
    } catch {}
  }
  try {
    term = nodePty().spawn("tmux", ["attach-session", "-t", target(sessionName)], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: apiConfig.home || process.cwd(),
      // COLORTERM matches addTerminalEnvironmentKeys (terminalEnvironment.ts) so
      // an attached editor client and an API client render the same colours.
      env: { ...process.env, COLORTERM: "truecolor" },
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
      let drainTimer: ReturnType<typeof setInterval> | undefined
      const pauseUntilDrained = () => {
        if (drainTimer) return
        term.pause()
        drainTimer = setInterval(() => {
          if (ws.bufferedAmount > MAX_WS_BUFFERED_BYTES / 2 && ws.readyState === ws.OPEN) return
          clearInterval(drainTimer)
          drainTimer = undefined
          if (!termExited) term.resume()
        }, 50)
        drainTimer.unref?.()
      }

      let pendingExit: number | undefined
      let flushTimer: ReturnType<typeof setTimeout> | undefined
      const queueExit = () => {
        if (pendingExit === undefined) return
        if (flushTimer) clearTimeout(flushTimer)
        flushTimer = setTimeout(() => {
          try {
            ws.send(JSON.stringify({ exit: { code: pendingExit } }))
            ws.close()
          } catch {}
        }, DATA_FLUSH_TIMEOUT_MS)
      }

      term.onData((data: string) => {
        try {
          ws.send(Buffer.from(data, "utf8"))
        } catch {}
        if (ws.bufferedAmount > MAX_WS_BUFFERED_BYTES) pauseUntilDrained()
        queueExit()
      })
      term.onExit(({ exitCode }: { exitCode: number }) => {
        termExited = true
        release()
        pendingExit = exitCode
        queueExit()
      })

      ws.on("message", (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          term.write(data.toString("utf8"))
          return
        }
        const text = data.toString("utf8")
        let message: any
        try {
          message = JSON.parse(text)
        } catch {
          term.write(text)
          return
        }
        // Text frames are JSON control messages, but JSON that is not one of
        // ours is stdin (pasting a config blob parses fine) - write it rather
        // than dropping it.
        if (message?.resize) {
          term.resize(clampDim(message.resize.cols, cols), clampDim(message.resize.rows, rows))
        } else if (message?.input != null) {
          term.write(String(message.input))
        } else {
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

httpRouter.delete("/sessions/:name", async (req, res) => {
  const name = req.params.name
  if (!validSessionName(name)) {
    res.status(400).json({ message: "invalid session name" })
    return
  }
  const code = await tmux(["kill-session", "-t", target(name)])
  if (code === -1) {
    res.status(504).json({ message: "tmux unavailable or timed out" })
    return
  }
  res.status(200).json({ killed: code === 0, name })
})
