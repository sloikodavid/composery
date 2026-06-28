import { spawn } from "child_process"
import * as express from "express"
import { apiConfig } from "./config"

export const router = express.Router()

interface ExecBody {
  command?: string
  cwd?: string
  env?: Record<string, string>
  timeout?: number
}

interface ExecResult {
  stdout: string
  stderr: string
  exit_code: number
  timed_out: boolean
  truncated: boolean
}

const idempotency = new Map<string, { at: number; result: ExecResult }>()
const IDEMPOTENCY_TTL_MS = 5 * 60_000

function rememberResult(key: string, result: ExecResult): void {
  const now = Date.now()
  for (const [existing, entry] of idempotency) {
    if (now - entry.at >= IDEMPOTENCY_TTL_MS) idempotency.delete(existing)
  }
  idempotency.set(key, { at: now, result })
}

router.post("/exec", async (req, res) => {
  const body = (req.body || {}) as ExecBody
  if (typeof body.command !== "string" || !body.command) {
    res.status(400).json({ message: "command is required" })
    return
  }

  const idemKey = req.headers["idempotency-key"]
  if (typeof idemKey === "string" && idemKey) {
    const hit = idempotency.get(idemKey)
    if (hit && Date.now() - hit.at < IDEMPOTENCY_TTL_MS) {
      res.json(hit.result)
      return
    }
  }

  const timeoutSec =
    typeof body.timeout === "number" && body.timeout > 0 ? body.timeout : apiConfig.execTimeoutSec

  const child = spawn(apiConfig.shell, ["-l", "-c", body.command], {
    cwd: body.cwd || apiConfig.home || process.cwd(),
    env: { ...process.env, ...(body.env || {}) },
  })

  const cap = apiConfig.execMaxOutput
  let stdout: Buffer = Buffer.alloc(0)
  let stderr: Buffer = Buffer.alloc(0)
  let truncated = false
  const append = (buffer: Buffer, chunk: Buffer): Buffer => {
    if (buffer.length >= cap) {
      truncated = true
      return buffer
    }
    if (buffer.length + chunk.length > cap) {
      truncated = true
      return Buffer.concat([buffer, chunk.subarray(0, cap - buffer.length)])
    }
    return Buffer.concat([buffer, chunk])
  }
  child.stdout.on("data", (chunk: Buffer) => {
    stdout = append(stdout, chunk)
  })
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = append(stderr, chunk)
  })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill("SIGTERM")
    setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {}
    }, 2000).unref()
  }, timeoutSec * 1000)

  let settled = false
  child.on("error", (error) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    res.status(500).json({ message: `exec failed: ${error.message}` })
  })
  child.on("close", (code) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    const result: ExecResult = {
      stdout: stdout.toString("utf8"),
      stderr: stderr.toString("utf8"),
      exit_code: code ?? -1,
      timed_out: timedOut,
      truncated,
    }
    if (typeof idemKey === "string" && idemKey) {
      rememberResult(idemKey, result)
    }
    res.json(result)
  })
})
