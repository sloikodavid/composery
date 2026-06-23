import * as path from "path"

// Single source of env truth for the API. Read once at startup. Nothing that an
// operator can vary is hardcoded; every value has a sane default.

function num(name: string, def: number): number {
  const raw = process.env[name]
  if (!raw) return def
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : def
}

export const apiConfig = {
  // `false` hard-disables the API (routes 404). Otherwise it auto-gates: no
  // keys means every endpoint 401s, so it is effectively off until one is minted.
  enabled: process.env.COMPOSERY_API_ENABLED !== "false",
  // Volume base, mirroring persistence's convention. The key store lives under it.
  dataDir: process.env.COMPOSERY_DATA_DIR || "/data",
  // Exec runs in the editor's own login shell as the code-server user - no drift.
  shell: process.env.SHELL || "/bin/bash",
  home: process.env.HOME,
  // One-shot exec bounds (the interactive websocket mode is unbounded).
  execTimeoutSec: num("COMPOSERY_API_EXEC_TIMEOUT", 60),
  execMaxOutput: num("COMPOSERY_API_EXEC_MAX_OUTPUT", 10 * 1024 * 1024),
  // Safety rails - quota/abuse, not DDoS (that is handled upstream). Never low
  // enough to bite a human or a real app.
  rateRps: num("COMPOSERY_API_RATE_RPS", 50),
  rateBurst: num("COMPOSERY_API_RATE_BURST", 200),
  maxSessions: num("COMPOSERY_API_MAX_SESSIONS", 50),
  authFailPerMin: num("COMPOSERY_API_AUTH_FAIL_PER_MIN", 20),
}

// `$COMPOSERY_DATA_DIR/api/keys.json` - must match the Rust CLI's resolution.
export function keysPath(): string {
  return path.join(apiConfig.dataDir, "api", "keys.json")
}
