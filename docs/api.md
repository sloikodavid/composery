---
title: API
description: Run commands against a running Composery from anywhere, authenticated by API keys minted on the instance.
---

Every Composery serves a small automation API on its own URL, in-process with the
editor, on the same single port. It lets you run commands against the instance from
outside the editor - `curl`, CI, a script, your laptop - using API keys you mint
on the instance. It is the same instance you already have root in; the API just makes that
shell programmatic and remote.

This is not a control-plane API. There is no lifecycle here (no create/stop/delete
of instances). The instance already exists; this only automates work inside it.

## Enabling it

The API is on by default but **auto-gated**: with no keys, every endpoint returns
`401`, so it is effectively off until you mint one. To turn it off entirely, set
`COMPOSERY_DISABLE_API=true` (every endpoint then returns `404`).

## API keys

Keys are created, listed, and revoked **on the instance** - being able to open the
editor is the authorization. You cannot mint a key remotely without already being
able to log in, which is the intended boundary.

In the editor, open the **File** menu and choose **Manage API Keys**. It lists the
instance's keys, creates new ones, and revokes the one you pick; a new key's secret
appears once, with a button to copy it.

In a terminal, the `composery` CLI does the same:

```bash
composery api key create --name ci      # prints the secret ONCE
composery api key list
composery api key revoke <id>
```

The secret (`composery_...`) is shown once at creation and never again - only its
SHA-256 hash is stored, in `<volume>/api/keys.json` (`0600`, on the persistent
volume so keys survive a redeploy; `/data` by default). Add `--json` to any command for
machine-readable output.

Authenticate with either header:

```
Authorization: Bearer composery_...
X-API-Key: composery_...
```

## Run a command (one-shot)

`POST /_composery/api/v1/exec` runs a command in a login shell as the editor user - the same
environment your editor terminal has - and returns the result.

```bash
curl -X POST https://<your-instance>/_composery/api/v1/exec \
  -H "Authorization: Bearer composery_..." \
  -H "Content-Type: application/json" \
  -d '{"command":"pnpm build","cwd":"~/app","timeout":600}'
```

```json
{
	"stdout": "...",
	"stderr": "...",
	"exit_code": 0,
	"timed_out": false,
	"truncated": false
}
```

Fields: `command` (required), `cwd` (default `$HOME`), `env` (overlay), `timeout`
(seconds). Combined stdout/stderr output is capped and the request is
time-bounded - these limits exist only because a synchronous request cannot stream
forever. For long or interactive work, use the websocket below. An
`Idempotency-Key` header makes a retried request return the first result instead
of re-running; overlapping retries with the same key wait for the running
command. Reusing a key for a different command payload returns `409`.

## Interactive terminal (websocket)

`WS /_composery/api/v1/exec` is a real terminal: a server-side PTY with stdin, live output, and
resize. No timeout, no output cap - it runs until the process exits or you
disconnect. Binary websocket messages are raw terminal I/O both ways; text
messages are JSON control, currently `{"resize":{"cols":N,"rows":N}}`.

Query parameters: `cmd` (default the login shell), `cols`, `rows`, and `session`.

## Watching them in the editor

A terminal the API opens **shows up as a terminal tab in the editor**, titled
with the command it is running - a tab reading `pnpm build`. Tabs are listed,
never focused: nothing steals your cursor or opens the panel, the same way the
editor surfaces terminals that survived a reload. Click one and you are in the
running terminal, sharing screen, scrollback, and input with whatever opened it.

Close a tab and it stays closed - closing it stops watching, it does not stop the
command. Run **Composery: Show API Terminals** to reopen whatever is still going.

Under the hood these are `tmux` sessions, which is how one terminal can have two
clients in it at once. Two consequences leak through: `Ctrl-B` is tmux's prefix
key inside these terminals, and a tmux session you started by hand is left alone
rather than pulled into the editor.

## Detached terminals

Without `?session=` a terminal stops when you disconnect.

Add `?session=<name>` to make the terminal **detached**: it keeps running after
you disconnect and reattaches when you reconnect with the same name. Detached
sessions survive an editor restart (not a container reboot, which is a real
reboot). Session names are 1-64 characters: letters, numbers, `.`, `_`, and `-`.
Passing `cmd` with the name of a session that already exists returns `409`
rather than attaching and quietly dropping the command.

```
GET    /_composery/api/v1/sessions          # list sessions
DELETE /_composery/api/v1/sessions/:name    # stop one
```

## Configuration

Timeouts, output caps, and rate limits are overridable through `COMPOSERY_API_*`
environment variables, listed with their defaults in
[Configuration - API](configuration.md#api).

## Webhooks

Webhook senders should call an application route such as `/hooks/linear`, not the exec
API directly. The receiver verifies the provider signature against the unchanged request
body, deduplicates the delivery, queues the work, and returns the provider's success
response quickly. Its worker can then run `claude -p ...`, `codex exec ...`, or any other
normal command locally. No Composery query parameters are involved.

For example, run a receiver on `127.0.0.1:3000`, add the following to
`/etc/caddy/Caddyfile`, and give the provider
`https://<your-instance>/hooks/linear`:

```text
handle /hooks/linear* {
	reverse_proxy 127.0.0.1:3000
}
```

The API remains useful when the caller is a system that can set an authorization header.
A provider webhook generally cannot, and embedding an API key in a URL would leak it into
logs and configuration. The local receiver also has the provider-specific raw-body and
retry semantics that a generic command endpoint cannot safely guess.
