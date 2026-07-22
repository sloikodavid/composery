import { logger } from "@coder/logger"
import * as crypto from "crypto"
import { wss, Router as WsRouter, type WebsocketRequest } from "../../wsRouter"
import { ensureVSCodeLoaded, ptyService } from "../vscode"
import { authenticate } from "./auth"
import { apiConfig } from "./config"
import { apiBasePath } from "./constants"
import { sessions } from "./ratelimit"
import { API_TERMINAL_WORKSPACE_ID, type PtyService } from "./terminals"

export const wsRouter = WsRouter()

function endWithStatus(req: WebsocketRequest, status: number, message: string): void {
  req.ws.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`)
}

function clampDim(value: string | number | null | undefined, fallback: number): number {
  const n = Math.floor(Number(value))
  return n >= 1 && n <= 1000 ? n : fallback
}

// What `createTerminalEnvironment` adds on top of the process environment for a
// terminal opened in the editor (addTerminalEnvironmentKeys in
// lib/vscode/.../terminal/common/terminalEnvironment.ts). That function lives in
// the workbench bundle and cannot be reached from here, so the keys are set
// directly; a test pins them to upstream's list.
function terminalEnv(): Record<string, string | undefined> {
  return { ...process.env, TERM_PROGRAM: "vscode", COLORTERM: "truecolor" }
}

wsRouter.ws(`${apiBasePath}/exec`, ensureVSCodeLoaded, async (req: WebsocketRequest) => {
  const auth = await authenticate(req)
  if (!auth.id) {
    endWithStatus(req, auth.status ?? 401, auth.message ?? "Unauthorized")
    return
  }
  const keyId = auth.id

  const pty: PtyService | undefined = ptyService()
  if (!pty) {
    logger.error("API terminal requested before the editor server finished loading")
    endWithStatus(req, 503, "Editor Not Ready")
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

  const url = new URL(req.url || "/", "http://localhost")
  const cols = clampDim(url.searchParams.get("cols"), 80)
  const rows = clampDim(url.searchParams.get("rows"), 24)
  const cmd = url.searchParams.get("cmd") || undefined
  const cwd = apiConfig.home || process.cwd()

  let id: number
  try {
    id = await pty.createProcess(
      {
        // The tab title in the editor, so it reads as the command it is running.
        name: cmd,
        executable: apiConfig.shell,
        args: cmd ? ["-l", "-c", cmd] : ["-l"],
        cwd,
        env: {},
      },
      cwd,
      cols,
      rows,
      "11",
      terminalEnv(),
      { ...process.env },
      {
        // Same shell integration an editor terminal gets; `suggestEnabled` drives
        // the editor's suggest widget, which has no meaning over a socket.
        shellIntegration: { enabled: true, suggestEnabled: false, nonce: crypto.randomUUID() },
        windowsUseConptyDll: false,
        environmentVariableCollections: undefined,
        workspaceFolder: undefined,
        isScreenReaderOptimized: false,
      },
      // Persistent, and belonging to no window in particular: this is an ordinary
      // editor terminal that happens to have been started over HTTP, so it shows
      // up in the editor and outlives the socket exactly like one opened with `+`.
      true,
      API_TERMINAL_WORKSPACE_ID,
      "",
    )
  } catch (error) {
    release()
    logger.error(`API terminal could not be created: ${error instanceof Error ? error.message : error}`)
    endWithStatus(req, 500, "Terminal unavailable")
    return
  }

  try {
    wss.handleUpgrade(req, req.ws, req.head, (ws) => {
      const listeners = [
        pty.onProcessData(({ id: from, event }) => {
          if (from !== id) return
          const data = typeof event === "string" ? event : event.data
          // Acknowledging only once the bytes have actually reached the socket is
          // what drives the pty host's flow control: it pauses the pty past
          // FlowControlConstants.HighWatermarkChars of unacknowledged output, so a
          // slow reader throttles the process instead of growing a buffer here.
          ws.send(Buffer.from(data, "utf8"), () => {
            void pty.acknowledgeDataEvent(id, data.length)
          })
        }),
        pty.onProcessExit(({ id: from, event }) => {
          if (from !== id) return
          release()
          try {
            ws.send(JSON.stringify({ exit: { code: event ?? -1 } }))
            ws.close()
          } catch {}
        }),
      ]

      ws.on("message", (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          void pty.input(id, data.toString("utf8"))
          return
        }
        const text = data.toString("utf8")
        let message: { resize?: { cols?: number; rows?: number }; input?: unknown }
        try {
          message = JSON.parse(text)
        } catch {
          void pty.input(id, text)
          return
        }
        // Text frames are JSON control messages, but JSON that is not one of ours
        // is stdin - pasting a config blob parses fine and must not vanish.
        if (message?.resize) {
          void pty.resize(id, clampDim(message.resize.cols, cols), clampDim(message.resize.rows, rows))
        } else if (message?.input != null) {
          void pty.input(id, String(message.input))
        } else {
          void pty.input(id, text)
        }
      })

      // Disconnecting stops streaming and nothing else. The terminal stays in the
      // editor, live, the way an editor terminal survives a browser reload -
      // shutting it down here would mean a command run over HTTP could never be
      // picked up afterwards. It is closed the way any terminal is: in the editor.
      const stopStreaming = () => {
        release()
        for (const listener of listeners) listener.dispose()
        // Output sent but never acknowledged - the socket died mid-flight - would
        // leave the pty paused at the high watermark with nobody left to ack it,
        // stalling the command until someone happened to open it in the editor
        // (which replays and clears the count). The pty host clamps this at zero.
        void pty.acknowledgeDataEvent(id, Number.MAX_SAFE_INTEGER)
      }
      ws.on("close", stopStreaming)
      ws.on("error", stopStreaming)

      void pty.start(id).then((result) => {
        if (result && "message" in result) {
          logger.error(`API terminal failed to launch: ${result.message}`)
          try {
            ws.send(JSON.stringify({ exit: { code: -1, message: result.message } }))
            ws.close()
          } catch {}
        }
      })

      req.ws.resume()
    })
  } catch {
    release()
    void pty.shutdown(id, true)
    try {
      endWithStatus(req, 500, "Terminal unavailable")
    } catch {}
  }
})
