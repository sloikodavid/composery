import * as path from "path"

export const MAX_EXEC_TIMEOUT_SEC = 24 * 60 * 60
const MAX_EXEC_OUTPUT_BYTES = 64 * 1024 * 1024
const MAX_RATE_RPS = 1000
const MAX_RATE_BURST = 10_000
const MAX_CONCURRENT_EXEC = 128
const MAX_SESSIONS = 500
const MAX_AUTH_FAIL_PER_MIN = 1000

// Only an explicit 1/true turns a surface off, like every other
// COMPOSERY_DISABLE_*: a typo has to leave the API reachable rather than
// silently 404 every request an operator still believes is wired up.
function disabled(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  return raw === "1" || raw === "true"
}

function num(name: string, def: number, max: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return def
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.min(value, max) : def
}

function int(name: string, def: number, max: number): number {
  const value = Math.floor(num(name, def, max))
  return value > 0 ? value : def
}

export const apiConfig = {
  enabled: !disabled("COMPOSERY_DISABLE_API"),
  shell: process.env.SHELL || "/bin/bash",
  home: process.env.HOME,
  execTimeoutSec: num("COMPOSERY_API_EXEC_TIMEOUT", 60, MAX_EXEC_TIMEOUT_SEC),
  execMaxOutput: int("COMPOSERY_API_EXEC_MAX_OUTPUT", 10 * 1024 * 1024, MAX_EXEC_OUTPUT_BYTES),
  rateRps: num("COMPOSERY_API_RATE_RPS", 50, MAX_RATE_RPS),
  rateBurst: int("COMPOSERY_API_RATE_BURST", 200, MAX_RATE_BURST),
  maxSessions: int("COMPOSERY_API_MAX_SESSIONS", 50, MAX_SESSIONS),
  maxConcurrentExec: int("COMPOSERY_API_MAX_CONCURRENT_EXEC", 16, MAX_CONCURRENT_EXEC),
  authFailPerMin: int("COMPOSERY_API_AUTH_FAIL_PER_MIN", 20, MAX_AUTH_FAIL_PER_MIN),
}

// Cross-language contract: volume root, `api/keys.json` path, and JSON shape must match Rust keystore.rs.
const DATA_ROOT = process.env.COMPOSERY_DOCKER_VOLUME_PATH?.trim() || "/data"

export function keysPath(): string {
  return path.join(DATA_ROOT, "api", "keys.json")
}
