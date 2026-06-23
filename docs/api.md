---
title: API
description: Run commands against a running Composery from anywhere, authenticated by API keys minted on the box.
---

Every Composery serves a small automation API on its own URL, in-process with the
editor, on the same single port. It lets you run commands against the box from
outside the editor — `curl`, CI, a script, your laptop — using API keys you mint
on the box. It is the same box you already have root in; the API just makes that
shell programmatic and remote.

This is not a control-plane API. There is no lifecycle here (no create/stop/delete
of boxes). The box already exists; this only automates work inside it.

## Enabling it

The API is on by default but **auto-gated**: with no keys, every endpoint returns
`401`, so it is effectively off until you mint one. To turn it off entirely, set
`COMPOSERY_API_ENABLED=false` (every endpoint then returns `404`).

## API keys

Keys are created, listed, and revoked **on the box** with the `composery` CLI —
local shell access is the authorization. You cannot mint a key remotely without
already being able to log in, which is the intended boundary.

```bash
composery api key create --name ci      # prints the secret ONCE
composery api key list
composery api key revoke <id>
```

The secret (`csy_...`) is shown once at creation and never again — only its
SHA-256 hash is stored, in `${COMPOSERY_DATA_DIR:-/data}/api/keys.json` (`0600`,
on the persistent volume so keys survive a redeploy). Add `--json` to any command
for machine-readable output.

Authenticate with either header:

```
Authorization: Bearer csy_...
X-API-Key: csy_...
```

## Run a command (one-shot)

`POST /v1/exec` runs a command in a login shell as the editor user — the same
environment your editor terminal has — and returns the result.

```bash
curl -X POST https://<your-box>/v1/exec \
  -H "Authorization: Bearer csy_..." \
  -H "Content-Type: application/json" \
  -d '{"command":"pnpm build","cwd":"~/app","timeout":600}'
```

```json
{ "stdout": "...", "stderr": "...", "exit_code": 0, "timed_out": false, "truncated": false }
```

Fields: `command` (required), `cwd` (default `$HOME`), `env` (overlay), `timeout`
(seconds). Output is capped and the request is time-bounded — these limits exist
only because a synchronous request cannot stream forever. For long or interactive
work, use the websocket below. An `Idempotency-Key` header makes a retried request
return the first result instead of re-running.

## Interactive terminal (websocket)

`WS /v1/exec` is a real terminal: a server-side PTY with stdin, live output, and
resize. No timeout, no output cap — it runs until the process exits or you
disconnect. Binary websocket messages are raw terminal I/O both ways; text
messages are JSON control, currently `{"resize":{"cols":N,"rows":N}}`.

Query parameters: `cmd` (default the login shell), `cols`, `rows`, and `session`.

## Detached sessions

Add `?session=<name>` to make the terminal **detached**: it is backed by `tmux`,
so it keeps running after you disconnect and reattaches when you reconnect with
the same name. Detached sessions survive an editor restart (not a container
reboot, which is a real reboot).

```
GET    /v1/sessions          # list detached sessions
DELETE /v1/sessions/:name    # kill one
```

## Configuration

All overridable via environment; defaults are sane and never bite real use.

| Variable | Default | Meaning |
|----------|---------|---------|
| `COMPOSERY_API_ENABLED` | `true` | `false` hard-disables the API. |
| `COMPOSERY_DATA_DIR` | `/data` | Volume base; key store at `<dir>/api/keys.json`. |
| `COMPOSERY_API_EXEC_TIMEOUT` | `60` | One-shot default timeout (seconds). |
| `COMPOSERY_API_EXEC_MAX_OUTPUT` | `10485760` | One-shot output cap (bytes). |
| `COMPOSERY_API_RATE_RPS` | `50` | Per-key sustained requests/sec. |
| `COMPOSERY_API_RATE_BURST` | `200` | Per-key burst. |
| `COMPOSERY_API_MAX_SESSIONS` | `50` | Concurrent sessions per key. |
| `COMPOSERY_API_AUTH_FAIL_PER_MIN` | `20` | Failed-auth attempts/min/IP. |

Rate limits are abuse/quota rails, not DDoS defense (that is handled by your
platform in front of the box). They never trip on normal automation.
