import * as path from "path"

function num(name: string, def: number): number {
  const raw = process.env[name]
  if (!raw) return def
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : def
}

export const apiConfig = {
  enabled: process.env.COMPOSERY_API_ENABLED !== "false",
  shell: process.env.SHELL || "/bin/bash",
  home: process.env.HOME,
  execTimeoutSec: num("COMPOSERY_API_EXEC_TIMEOUT", 60),
  execMaxOutput: num("COMPOSERY_API_EXEC_MAX_OUTPUT", 10 * 1024 * 1024),
  rateRps: num("COMPOSERY_API_RATE_RPS", 50),
  rateBurst: num("COMPOSERY_API_RATE_BURST", 200),
  maxSessions: num("COMPOSERY_API_MAX_SESSIONS", 50),
  authFailPerMin: num("COMPOSERY_API_AUTH_FAIL_PER_MIN", 20),
}

// Cross-language contract: volume root, `api/keys.json` path, and JSON shape must match Rust keystore.rs.
const DATA_ROOT = process.env.COMPOSERY_DOCKER_VOLUME_PATH?.trim() || "/data"

export function keysPath(): string {
  return path.join(DATA_ROOT, "api", "keys.json")
}
