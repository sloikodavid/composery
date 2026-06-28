import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import * as express from "express"
import * as path from "path"
import { apiConfig } from "./config"
import { execs } from "./ratelimit"

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

interface IdempotencyEntry {
  at: number
  fingerprint: string
  result: ExecResult
}

interface InFlightExec {
  fingerprint: string
  promise: Promise<ExecResult>
}

const idempotency = new Map<string, IdempotencyEntry>()
const inFlight = new Map<string, InFlightExec>()
const IDEMPOTENCY_TTL_MS = 5 * 60_000
const IDEMPOTENCY_MAX_RESULTS = 1024
const MAX_TIMEOUT_SEC = Math.floor(2_147_483_647 / 1000)

interface OutputBuffer {
  chunks: Buffer[]
  length: number
}

interface OutputBudget {
  used: number
  cap: number
}

function rememberResult(key: string, fingerprint: string, result: ExecResult): void {
  const now = Date.now()
  for (const [existing, entry] of idempotency) {
    if (now - entry.at >= IDEMPOTENCY_TTL_MS) idempotency.delete(existing)
  }
  idempotency.set(key, { at: now, fingerprint, result })
  while (idempotency.size > IDEMPOTENCY_MAX_RESULTS) {
    const oldest = idempotency.keys().next().value
    if (!oldest) break
    idempotency.delete(oldest)
  }
}

function resolveCwd(cwd: string | undefined): string {
  const fallback = apiConfig.home || process.cwd()
  if (typeof cwd !== "string" || !cwd.trim()) return fallback
  const value = cwd.trim()
  if (value === "~") return fallback
  if (value.startsWith("~/")) return path.join(fallback, value.slice(2))
  return value
}

function resolveTimeoutSec(timeout: unknown): number {
  const value =
    typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0
      ? timeout
      : apiConfig.execTimeoutSec
  return Math.min(value, MAX_TIMEOUT_SEC)
}

function resolveEnv(env: unknown): NodeJS.ProcessEnv | undefined {
  if (env === undefined) return undefined
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    throw new Error("env must be an object with string values")
  }

  const resolved: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") {
      throw new Error("env must be an object with string values")
    }
    resolved[key] = value
  }
  return resolved
}

function appendOutput(target: OutputBuffer, chunk: Buffer, budget: OutputBudget): boolean {
  const remaining = budget.cap - budget.used
  if (remaining <= 0) return true
  if (chunk.length > remaining) {
    target.chunks.push(chunk.subarray(0, remaining))
    target.length += remaining
    budget.used = budget.cap
    return true
  }
  target.chunks.push(chunk)
  target.length += chunk.length
  budget.used += chunk.length
  return false
}

function requestFingerprint(command: string, cwd: string, env: NodeJS.ProcessEnv | undefined, timeoutSec: number): string {
  const sortedEnv = env
    ? Object.fromEntries(Object.entries(env).sort(([left], [right]) => left.localeCompare(right)))
    : undefined
  return JSON.stringify({ command, cwd, env: sortedEnv, timeoutSec })
}

function canRespond(res: express.Response): boolean {
  return !res.destroyed && !res.writableEnded
}

function runCommand(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv | undefined,
  timeoutSec: number,
  cancelOnClose?: express.Response,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(apiConfig.shell, ["-l", "-c", command], {
        cwd,
        env: { ...process.env, ...(env || {}) },
      })
    } catch (error) {
      execs.release()
      reject(error)
      return
    }

    const outputBudget: OutputBudget = { used: 0, cap: apiConfig.execMaxOutput }
    const stdout: OutputBuffer = { chunks: [], length: 0 }
    const stderr: OutputBuffer = { chunks: [], length: 0 }
    let truncated = false
    child.stdout.on("data", (chunk: Buffer) => {
      truncated = appendOutput(stdout, chunk, outputBudget) || truncated
    })
    child.stderr.on("data", (chunk: Buffer) => {
      truncated = appendOutput(stderr, chunk, outputBudget) || truncated
    })

    let timedOut = false
    let stopping = false
    let released = false
    let settled = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const release = () => {
      if (released) return
      released = true
      execs.release()
    }
    const stopChild = () => {
      if (stopping) return
      stopping = true
      child.kill("SIGTERM")
      killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL")
        } catch {}
      }, 2000).unref()
    }
    const onResponseClose = () => {
      if (!settled) stopChild()
    }
    const timer = setTimeout(() => {
      timedOut = true
      stopChild()
    }, timeoutSec * 1000)
    const cleanup = () => {
      release()
      clearTimeout(timer)
      if (killTimer) {
        clearTimeout(killTimer)
        killTimer = undefined
      }
      cancelOnClose?.off("close", onResponseClose)
    }

    cancelOnClose?.on("close", onResponseClose)
    child.on("error", (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })
    child.on("close", (code) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({
        stdout: Buffer.concat(stdout.chunks, stdout.length).toString("utf8"),
        stderr: Buffer.concat(stderr.chunks, stderr.length).toString("utf8"),
        exit_code: code ?? -1,
        timed_out: timedOut,
        truncated,
      })
    })
  })
}

router.post("/exec", async (req, res) => {
  const body = (req.body || {}) as ExecBody
  if (typeof body.command !== "string" || !body.command) {
    res.status(400).json({ message: "command is required" })
    return
  }

  const timeoutSec = resolveTimeoutSec(body.timeout)
  let env: NodeJS.ProcessEnv | undefined
  try {
    env = resolveEnv(body.env)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(400).json({ message })
    return
  }
  const cwd = resolveCwd(body.cwd)
  const idemKeyHeader = req.headers["idempotency-key"]
  const idemKey = typeof idemKeyHeader === "string" && idemKeyHeader ? idemKeyHeader : undefined
  const fingerprint = idemKey ? requestFingerprint(body.command, cwd, env, timeoutSec) : undefined

  if (idemKey && fingerprint) {
    const hit = idempotency.get(idemKey)
    if (hit && Date.now() - hit.at >= IDEMPOTENCY_TTL_MS) {
      idempotency.delete(idemKey)
    } else if (hit) {
      if (hit.fingerprint !== fingerprint) {
        res.status(409).json({ message: "Idempotency-Key already used for a different request" })
        return
      }
      res.json(hit.result)
      return
    }
    const running = inFlight.get(idemKey)
    if (running) {
      if (running.fingerprint !== fingerprint) {
        res.status(409).json({ message: "Idempotency-Key already used for a different request" })
        return
      }
      try {
        const result = await running.promise
        if (canRespond(res)) res.json(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (canRespond(res)) res.status(500).json({ message: `exec failed: ${message}` })
      }
      return
    }
  }

  if (!execs.tryAcquire()) {
    res.status(429).json({ message: "Too many concurrent exec requests" })
    return
  }

  const promise = runCommand(body.command, cwd, env, timeoutSec, idemKey ? undefined : res)
  if (idemKey && fingerprint) {
    inFlight.set(idemKey, { fingerprint, promise })
    void promise
      .then((result) => {
        rememberResult(idemKey, fingerprint, result)
      }, () => {
        // Failed execs are returned to waiters but are not cached as idempotent results.
      })
      .finally(() => {
        if (inFlight.get(idemKey)?.promise === promise) inFlight.delete(idemKey)
      })
  }
  try {
    const result = await promise
    if (canRespond(res)) res.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (canRespond(res)) {
      res.status(500).json({ message: `exec failed: ${message}` })
    }
  }
})
