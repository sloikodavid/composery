# Composery API Plan

## 0. Purpose

This document is the handoff plan for the **box-local automation API**: a way to
run commands against an already-running Composery from outside the editor
(curl, CI, SDKs, a remote machine), authenticated by API keys minted on the
box.

It is written for a new engineer or agent with no prior context. Every load-
bearing decision is settled here. Where something is explicitly left to
implementation, it says so.

This is **not** a control-plane API. There is no box lifecycle here (no
create/start/stop/delete, no Hetzner, no billing). The box already exists; this
API only lets people automate work *inside* it.

## 0.1 What Composery Is (the constraints that shape everything)

- A Composery is a persistent Linux box running patched **code-server**
  (`packages/ide`) behind one HTTP port, with **persistence** (`packages/cli`,
  Rust) restoring the rootfs from one mounted volume on boot.
- Deployment targets are **any PaaS that gives a volume, or any VPS** — wider
  than n8n. The lowest common denominator is hard law:
  - **One inbound port** (`$PORT`, default 8080). The platform terminates TLS
    and routes to it. There is no second port to bind and no reverse proxy we
    control on PaaS.
  - **One persistent volume** (default `/data`); everything else is ephemeral
    or reset to the image on redeploy.
  - **Two init systems** (systemd and supervisor), abstracted in
    `rootfs/opt/composery/init/`.
- The box owner already has **root and a full terminal** in the editor. An exec
  API gives the owner no new capability; it makes that shell *programmatic and
  remote*. The only new risk surface is **the API key**, which grants exactly
  what the owner already has, scoped to this one box.

## 0.2 The One Architectural Consequence

Because there is exactly one port and no proxy we control, the API **must be
served in-process by code-server**, on its existing port, under a path prefix.
It cannot be a second service on its own port (works on a VPS, breaks on every
PaaS). This is the same mechanism the repo already uses for `register` /
`reset-password`: an owned route file in
`packages/ide/overlay/src/node/routes/`.

code-server has **no existing exec/terminal REST API** to reuse — terminals
live inside VS Code's private `ptyHost` behind the workbench websocket. So we
build the surface, reusing only code-server's route + websocket plumbing and a
PTY library for the interactive path.

## 1. Product Contract

A holder of a valid API key can, against `https://<box-host>/v1/...`:

1. **Run a one-shot command** and get its stdout/stderr/exit code back.
2. **Open an interactive terminal session** (a real PTY: stdin, live output,
   resize) over a websocket — for REPLs, `vim`, watching a long build stream.
3. Optionally make that interactive session **detached**: it keeps running
   after disconnect and can be reattached by id (backed by `tmux`).

Keys are created, listed, and revoked **only on the box**, via the
`composery api key` CLI. There is no UI in v1.

## 2. Non-Goals (v1)

- No control-plane / lifecycle operations.
- No file-transfer API (use exec: `cat`, `tee`, `tar`).
- No scopes/permissions on keys (single capability surface; revisit if the
  surface grows).
- No in-editor GUI, no VS Code extension, no settings page.
- No remote first-key bootstrap (minting needs box shell access — see §6).
- No detached-session survival across a **container** restart (tmux survives an
  editor restart, not a reboot — that is the correct expectation).
- No async "fire-and-forget with a results store" mode (SSM-style). Long fire-
  and-forget is covered by detached sessions or by backgrounding inside the
  command.

## 3. Hard Requirements

- Works on a single port, in-process with code-server, on every target (VPS and
  volume-PaaS) from the same image.
- No credential with power beyond this one box ever leaves the box. The API key
  authenticates only this box's API.
- Nothing configurable is hardcoded (see §11). The volume base, shell, home,
  limits, and enable flag are all derived from env with sane defaults.
- Exec runs in an environment **identical to the editor's terminal at the OS
  level**: same user (the code-server process uid, `user`), same login shell
  (`$SHELL`), same env and dotfiles. No drift.
- Auth, rate limiting, and exec must not depend on the persistence daemon being
  healthy beyond the normal readiness gate.

## 4. Where Everything Lives (settled layout)

Three names line up — `api` everywhere, no `composery` prefix on internal
things (the box *is* Composery; prefixing is redundant). The prefix survives
only where a foreign namespace needs it (the CLI binary `composery`, VS Code
extension ids).

```
CLI group     composery api key {create,list,revoke}
Volume dir    <data>/api/keys.json
Wire          /v1/...   (served by code-server)
Rust module   packages/cli/crates/composery/src/commands/api.rs
TS routes     packages/ide/overlay/src/node/routes/api/
```

### 4.1 Rust (key management), `packages/cli/crates/composery/`

```
src/
  keystore.rs            NEW  KeyStore: load/save (atomic), create/list/revoke,
                              KeyRecord, sha256 hashing, key generation, path
                              resolution from env. The on-disk contract.
  commands/
    mod.rs               EDIT add `pub mod api;`, an `Api` variant, dispatch.
    api.rs               NEW  `ApiCommand` -> `KeyCommand {Create,List,Revoke}`;
                              also hidden helpers if delegation is chosen (none
                              in the default design; see §8.3).
  lib.rs                 EDIT add `mod keystore;`.
Cargo.toml (workspace)   EDIT add sha2, getrandom, base64 to workspace deps.
crates/composery/Cargo.toml EDIT pull those three in.
```

`api.rs` mirrors `persistence.rs` exactly: a `Subcommand` enum, a `run()` that
constructs config and dispatches. `key create` prints the secret once (human)
or as JSON (`--json`, the existing global flag, via `output::render`).

### 4.2 TypeScript (the wire), `packages/ide/overlay/src/node/routes/api/`

```
index.ts      NEW  express Router + WebsocketRouter; mounts /v1 endpoints;
                   applies config gate (enabled), auth, rate limit.
config.ts     NEW  read env once: dataDir, shell, home, limits, timeout,
                   maxOutput, enabled. Single source of env truth (no hardcode).
keystore.ts   NEW  read keys.json, verify a presented secret (sha256, constant-
                   time compare). Matches the Rust on-disk format byte-for-byte.
auth.ts       NEW  ensureApiKey middleware (Authorization: Bearer OR X-API-Key);
                   401 on miss; feeds the rate limiter; attaches req.apiKeyId.
ratelimit.ts  NEW  in-memory token bucket per key id + failed-auth bucket per
                   IP + concurrent-session counter. All limits from config.
exec.ts       NEW  POST /v1/exec one-shot: spawn login shell, capped output,
                   timeout kill, returns {stdout,stderr,exit_code,timed_out}.
session.ts    NEW  WS /v1/exec interactive: PTY <-> websocket bridge; optional
                   tmux-backed detach; GET /v1/sessions, DELETE /v1/sessions/:id.
pty.ts        NEW  isolated node-pty acquisition + spawn helpers (the one piece
                   needing validation on the real Linux build; see §8.3).
```

`routes/index.ts` EDIT: mount the api router on `app.router` and the api ws on
`app.wsRouter`, **after** the persistence readiness gate and `/healthz`, and
**before** the `/` VS Code catch-all. The api uses its own bearer auth, never
code-server's session cookie.

### 4.3 Image

- `Dockerfile` EDIT: add `tmux` to the runtime apt list (detached sessions).
- No `EXPOSE`/port change. CLI binary already built and installed; `api` is new
  source only.
- node-pty: see §8.3 for acquisition; may add a dependency to the code-server
  build if bundle-resolution proves unreliable.

### 4.4 Docs (follow-up, not blocking)

A `packages/docs-website` page covering the two modes, auth headers, and
`composery api key`. Noted here; wire into fumadocs `meta.json` when written.

## 5. API Keys

### 5.1 Format

- Secret shown once at creation: `csy_` + base64url(32 random bytes from a CSPRNG).
- Stored: only `sha256(secret)` as hex. The secret is never written to disk.
- `prefix`: first ~12 chars of the secret, for display/identification only.
- `id`: `k_` + hex(6 random bytes), stable handle for `list`/`revoke`.

Prefix + a fixed scheme makes the key scannable by secret-scanners; storing only
the hash means a stolen `keys.json` yields no usable keys.

### 5.2 On-disk store — `<data>/api/keys.json`

Mode `0600`, owner = the code-server user, dir `<data>/api` mode `0700`. Written
atomically (temp file + fsync + rename + dir fsync), mirroring
`persistence/config.rs`.

```json
{
  "version": 1,
  "keys": [
    {
      "id": "k_3f9a2c4d",
      "name": "ci",
      "prefix": "csy_3f9a2c",
      "hash": "sha256:9b74c9897bac770ffc029102a200c5de...",
      "created_at": 1750000000
    }
  ]
}
```

`created_at` is unix seconds. There is deliberately **no** `last_used_at` field
in v1: tracking it means either a write to the volume per request (hammers the
disk, races the CLI writer) or a throttled merge-flusher (real machinery for
key-hygiene polish, not v1 function). It is a clean additive feature later. Hash
algorithm is plain SHA-256 hex specifically so the Rust writer and the TS reader
agree trivially — that agreement is the cross-language contract; do not change it
on one side.

### 5.3 Why the volume, and why excluded

The store lives on the **volume** because that is the only place that survives a
**redeploy** (image swap) — you do not want every deploy to invalidate CI keys.
It lives under `<data>/` (which persistence **excludes**, see
`persistence/config.rs` default exclusions) rather than in the normal rootfs so
that **auth never depends on the persistence daemon's correctness**: the API
reads the key file straight off the raw volume even if persistence is degraded.
This mirrors how persistence stores its *own* state under `/data/persistence`.

### 5.4 Auto-gate (no separate on/off needed)

If `keys.json` has no keys, every authenticated endpoint returns 401 — the API
is effectively off until the owner mints a key. An explicit
`COMPOSERY_API_ENABLED=false` hard-disables it (routes 404) for operators who
want it fully gone.

## 6. Minting (CLI-only)

`composery api key create|list|revoke`, a new subsystem group beside
`composery persistence`. The CLI writes/reads `keys.json` directly on the local
filesystem — **local shell access is the authorization**; there is no network
auth for minting and no HTTP mint endpoint. You cannot obtain a key without
already being able to log into the box.

Consequence, stated honestly: the **first** key cannot be minted remotely
without box shell access. That is the correct security boundary, not a bug. (A
hosted control plane can run the CLI over its own SSH channel; a password-gated
bootstrap endpoint could be added later if a real need appears. Out of scope
for v1.)

```
composery api key create --name ci      # prints csy_... ONCE, then never again
composery api key list                  # table: id, name, prefix, created
composery api key revoke <id>           # removes by id
```

JSON via the existing global `--json`.

## 7. Exec Model — two modes (this is the core)

SSE is rejected: it is one-way and cannot drive a terminal (no stdin, no
resize). The wild is unanimous — interactive terminals are **websocket + PTY**
(xterm.js/node-pty/ttyd/gotty, and VS Code's own terminal). So:

### 7.1 Mode 1 — one-shot (`POST /v1/exec`)

For "launch a command, get the result." Synchronous, buffered.

Request:
```json
{ "command": "pnpm build", "cwd": "~/app", "env": {"CI":"1"}, "timeout": 600 }
```
- `command`: shell string, run as `"$SHELL" -l -c "<command>"` (login shell =
  identical env to the editor terminal). Not argv; it is the owner's root box,
  so shell parsing is theirs to own.
- `cwd`: optional, default `$HOME`. `~`/`$VARS` expanded by the login shell.
- `env`: optional overlay on the inherited box env.
- `timeout`: optional seconds, default from config; on expiry SIGTERM then
  SIGKILL; response sets `timed_out: true`.

Response:
```json
{ "stdout": "...", "stderr": "...", "exit_code": 0, "timed_out": false }
```
- Output is capped (config `maxOutput`); on overflow the stream is truncated and
  `truncated: true` is set. These caps exist **only** because a sync HTTP
  request cannot hang forever or buffer unbounded memory. If you want no limits,
  use Mode 2.
- Honors `Idempotency-Key` (a repeat within a short in-memory window returns the
  first result instead of re-running).

### 7.2 Mode 2 — interactive (`WS /v1/exec`)

A real terminal. **No timeout, no output cap** — it streams until the process
exits or the socket closes, exactly like a terminal.

- Upgrade via code-server's shared `wss` (`wsRouter.ws`, the `health.ts`
  pattern). Auth runs as a handler before the upgrade.
- Query params: `cmd` (optional; default the login shell), `cols`, `rows`,
  `session` (optional; presence makes it detached — see §7.3).
- Framing: **binary** ws messages are raw PTY I/O both ways. **text** ws messages
  are JSON control, currently only `{"resize":{"cols":N,"rows":N}}`.
- The PTY runs `"$SHELL" -l` (or `"$SHELL" -l -c cmd`) as the code-server uid.
- On process exit the server sends a final text control
  `{"exit":{"code":N}}` then closes. On socket close (ephemeral) the PTY is
  killed.

### 7.3 Detached (a property of Mode 2, via tmux — not a third mode)

The earlier hesitation about detached was the cost of building a session
registry + output ring buffer + orphan reaper + restart-survival **ourselves**.
We do not build that. We back detached sessions with **tmux**, which already is
all of it and is battle-tested.

- `WS /v1/exec?session=<name>` runs `tmux new-session -A -s <name> [cmd]` inside
  the PTY (`-A` = attach-or-create). Disconnecting leaves the tmux session
  alive; reconnecting with the same `session` reattaches with scrollback.
- `GET /v1/sessions` -> `tmux ls` parsed to JSON.
- `DELETE /v1/sessions/:name` -> `tmux kill-session -t <name>`.
- tmux runs as the code-server uid; its server is its own daemon, so sessions
  survive a **code-server restart** but not a container reboot (correct).
- Ephemeral interactive (no `session`) spawns the shell directly (no tmux), dies
  on disconnect — casual use stays a raw terminal, detach is opt-in.
- Concurrency: number of live detached sessions per key is capped (config).

## 8. Cross-cutting Decisions

### 8.1 Auth headers — both

Accept `Authorization: Bearer <key>` (primary; universal, OpenAPI-friendly) and
`X-API-Key: <key>` (fallback; what many webhook senders/scripts reach for).
Check `Authorization` first. ~3 lines, strictly better than one.

### 8.2 Rate limits — safety rails, never a tax on real use

In-memory, per-process, reset on restart. Framed as abuse/quota control, **not**
DDoS defense (volumetric floods are handled upstream by the platform LB/CDN; on
one box you cannot out-engineer that, and nothing upstream is key-aware — which
is the one thing this layer adds). Defaults, all env-overridable (§11):

- Per key: token bucket ~50 req/s sustained, burst 200.
- Concurrent interactive/detached sessions per key: ~50.
- Failed-auth per IP: ~20/min (cheap guessing deterrent; keys are high-entropy).

None low enough to bite a human or a sane app turning their box into a real
application. They only ever fire on a runaway loop or an attacker.

### 8.3 The PTY acquisition (the one validate-on-build item)

Mode 1 needs no PTY (`child_process.spawn`). Mode 2 needs a server-side PTY.
node-pty is the standard and is **already compiled into the shipped release**
(VS Code bundles it; same Node ABI as code-server's process). Default approach:
`pty.ts` requires node-pty, resolving it from the VS Code server bundle in the
release if a bare `require("node-pty")` misses. This keeps PTY/resize handling
trivial in TS (`pty.resize(cols,rows)`), which is why this is chosen over
delegating the PTY to a Rust helper (delegation makes resize a side-channel
problem). If bundle resolution proves unreliable on the real Linux build, the
fallback is to add `node-pty` to the code-server build deps — isolated entirely
in `pty.ts`, no other file changes.

## 9. Request Lifecycle (order in `routes/index.ts`)

1. existing common middleware + TLS redirect.
2. existing persistence readiness gate (api is gated too — no exec on a half-
   restored fs).
3. `/healthz` (unchanged).
4. **api router** (`/v1/...`): config-enabled gate -> auth (bearer/x-api-key) ->
   rate limit -> handler. **api ws** registered on `app.wsRouter` for
   `/v1/exec`.
5. existing `/login`, `/register`, `/reset-password`, `/logout`, `/update`.
6. `/` VS Code catch-all (must remain last).

Collision check: VS Code's web routes do not use `/v1`; verify once at build.

## 10. Security Notes

- Key minting requires local shell access; no remote bootstrap (§6).
- Store is hashed-only, `0600`, on the excluded volume; a stolen file is inert.
- Exec runs as the unprivileged code-server uid (the editor user), not root —
  identical to what the editor terminal can do, nothing more.
- The api is gated by persistence readiness, so it cannot act on a half-built
  filesystem.
- Bearer/X-API-Key compared in constant time; failed auth is IP-rate-limited.
- No secrets logged. Exec invocations are logged (command + key id + exit) to
  the journal for an audit trail; key secrets and stdin/stdout are not logged.

## 11. Configuration (nothing hardcoded that can vary)

All read once in `config.ts` (TS) and from env in `keystore.rs`/`api.rs` (Rust),
with the listed defaults. `COMPOSERY_*` vars are already propagated into the
runtime env by `rootfs/opt/composery/entrypoint.sh`.

| Var | Default | Meaning |
|-----|---------|---------|
| `COMPOSERY_DATA_DIR` | `/data` | Volume base. Store at `$COMPOSERY_DATA_DIR/api/keys.json`. Matches persistence's `/data` convention. |
| `COMPOSERY_API_ENABLED` | `true` | `false` hard-disables the api (routes 404). |
| `COMPOSERY_API_EXEC_TIMEOUT` | `60` | One-shot default timeout (seconds). |
| `COMPOSERY_API_EXEC_MAX_OUTPUT` | `10485760` | One-shot stdout+stderr cap (bytes). |
| `COMPOSERY_API_RATE_RPS` | `50` | Per-key sustained requests/sec. |
| `COMPOSERY_API_RATE_BURST` | `200` | Per-key burst. |
| `COMPOSERY_API_MAX_SESSIONS` | `50` | Concurrent sessions per key. |
| `COMPOSERY_API_AUTH_FAIL_PER_MIN` | `20` | Failed-auth attempts/min/IP. |
| `SHELL` | login shell from passwd | Shell used for exec; inherited, not hardcoded. |
| `HOME` | the user's home | Default exec cwd; inherited. |

The Rust and TS sides MUST resolve `COMPOSERY_DATA_DIR` identically (default
`/data`, joined with `api/keys.json`).

## 12. Testing

- Rust unit tests beside `keystore.rs`: create -> list -> revoke round-trip;
  hash stability vs a known vector (locks the cross-language contract); atomic
  write leaves no temp file; `0600`/`0700` perms; path resolution honors
  `COMPOSERY_DATA_DIR`. Mirror `persistence/config.rs` test style.
- TS route tests in `packages/ide` test harness: 401 without/with-bad key; 200
  one-shot echo + exit code; timeout sets `timed_out`; output cap truncates;
  rate limiter trips at the configured burst; auth accepts both headers.
- A smoke addition: from a built image, `composery api key create`, then a curl
  one-shot, then a websocket interactive echo, then a detached session that
  survives a code-server restart and is reattached.

## 13. Implementation Slices

1. **Rust keystore + CLI.** `keystore.rs`, `commands/api.rs`, wire `mod.rs` +
   `lib.rs`, deps. Tests. This is self-contained and unblocks everything (it
   creates the store the TS side reads).
2. **TS config + keystore + auth.** `config.ts`, `keystore.ts`, `auth.ts`,
   `ratelimit.ts`. Mount an empty `/v1` router; prove 401/200 auth against a
   key minted by slice 1.
3. **One-shot exec.** `exec.ts`. `POST /v1/exec` end to end.
4. **Interactive + detached.** `pty.ts`, `session.ts`, `tmux` in the Dockerfile,
   `/v1/sessions`.
5. **Docs + smoke.**

## 14. Open-during-implementation (decide while building, do not block)

- Exact ws control-frame schema beyond `resize` (e.g. a `signal` control) — add
  only if a real need appears.
- node-pty bundle path resolution vs adding the build dep (§8.3) — pick whatever
  the real Linux build proves reliable; isolated in `pty.ts`.
- `tmux` minimal config (no status bar, passthrough) so detached sessions feel
  like a raw terminal.

## 15. Acceptance Criteria

- `composery api key create|list|revoke` works; secret shown once; store is
  `0600` hashed JSON on the volume; survives a redeploy.
- The same image serves the api on the single port on a VPS and on a volume-
  PaaS, with no second port and no proxy assumption.
- `POST /v1/exec` runs a command as the editor user in an identical login-shell
  environment and returns stdout/stderr/exit code, with timeout + output caps.
- `WS /v1/exec` is a real interactive terminal (stdin, live output, resize),
  unbounded.
- `WS /v1/exec?session=x` survives disconnect and a code-server restart and is
  reattachable; `GET/DELETE /v1/sessions` list/kill them.
- Both auth headers accepted; no key => 401; `COMPOSERY_API_ENABLED=false` =>
  404; rate limits enforced from config and never bite normal use.
- Nothing configurable is hardcoded (§11), and Rust/TS resolve the store path
  identically.

## 16. Final Warning

- Do not add a second port or assume a reverse proxy.
- Do not put a control-plane credential on the box; the api key authenticates
  only this box.
- Do not let the Rust writer and TS reader of `keys.json` drift (same path, same
  sha256 hex).
- Do not reintroduce SSE for the terminal; it cannot carry stdin/resize.
- Do not build a bespoke detached-session subsystem; tmux owns that.
- Do not run exec as root; run as the editor user.

Keep the model simple:

```
one image, one port, in-process with code-server:
  api key (hashed, on the volume)  ->  auth  ->  { one-shot exec | interactive PTY (± tmux detach) }
```
