---
title: Configuration
description: Runtime environment variables for Composery.
---

Composery does not wrap upstream runtime settings - you configure it with environment
variables. In the Compose examples, set them in `composery.env`; Compose loads that file
into the container (`env_file`). Other hosting providers use their own environment-variable
UI.

The init system is selected by `COMPOSERY_INIT`, set in the compose service's
`environment:` block (not in `composery.env`). The default is `supervisor`; use `systemd`
on hosts that allow privileged containers and host cgroups.

The persistence engine is selected the same way by `COMPOSERY_PERSISTENCE`. The default is
`auto`, which works on every deployment target. See [Persistence](persistence.md#engines).

On a Composery Cloud box there is no `composery.env` to edit: the box's environment is
rendered from its configuration on the website, so set these from the box's Configuration
page instead. The variables that select the init system, the persistence engine, the ports,
and the volume root are part of that deployment's contract and are not configurable there;
the password is changed from the box page rather than set as a variable.

## Variables

| Variable                                                 | Use                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COMPOSERY_PASSWORD`                                     | Sets a plaintext IDE password. Skips first-visit registration, and overrides a password registered earlier - set it and restart if you forget yours.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `COMPOSERY_HASHED_PASSWORD`                              | Sets an argon2 hashed password and takes precedence over `COMPOSERY_PASSWORD`. Single-quote values containing `$` in `composery.env`.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `COMPOSERY_REMOVE_PASSWORD`                              | Set to `1` or `true` to delete the registered password on **every** boot, leaving the instance open for anyone who reaches it to claim. Set it back to `0` or remove it as soon as you have registered a new password. See [Forgotten password](self-hosting/index.md#forgotten-password).                                                                                                                                                                                                                                                                                              |
| `COMPOSERY_DISABLE_AUTH`                                 | Set to `1` or `true` to serve the IDE with no sign-in at all: anyone who can reach it gets a root-capable terminal, so only use it behind a gate of your own (a private network, an SSO proxy). Removes the sign-in, registration and password-change pages along with the Sign Out and Change Password commands, and ignores any password set above. API keys are unaffected - use `COMPOSERY_DISABLE_API` for those.                                                                                                                                                                  |
| `PORT`                                                   | Changes the container's HTTP port (default `8080`). Also update `expose`, health checks, or platform routing when you change it.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `COMPOSERY_IDE_PORT`                                     | Changes the loopback port Caddy proxies the IDE on (default `8081`). It must differ from `PORT`; the container refuses to start if they match.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `COMPOSERY_PROXY_URI`                                    | Controls links in the Ports panel, e.g. `https://{{port}}.dev.example.com`. The default path proxy works without setting this, and `COMPOSERY_DISABLE_PROXY` turns the routes off whatever this says.                                                                                                                                                                                                                                                                                                                                                                                   |
| `COMPOSERY_DISABLE_FILE_DOWNLOADS`                       | Set to `1` or `true` to block browser file downloads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `COMPOSERY_DISABLE_FILE_UPLOADS`                         | Set to `1` or `true` to block browser file uploads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `COMPOSERY_DISABLE_PROXY`                                | Set to `1` or `true` to disable the IDE's port proxy routes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `COMPOSERY_EXTENSIONS_GALLERY`                           | Points the IDE at a custom VS Code Extension Gallery API using the JSON shape expected by VS Code `product.json`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `COMPOSERY_LOG_LEVEL`                                    | Sets IDE logging to `trace`, `debug`, `info`, `warn`, or `error`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `COMPOSERY_GITHUB_TOKEN`                                 | Supplies the IDE's GitHub auth token. Treat it as a secret; the IDE removes it from the child-process environment at start.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `COMPOSERY_CONFIG`                                       | Overrides the IDE YAML config path. Keep it on persisted storage, or the registered password is gone after every restart.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `COMPOSERY_DOCKER_VOLUME_PATH`                           | Overrides the persistent volume root (default `/data`). The mount target in your compose/platform config must match; the container warns at start when nothing is mounted there.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `COMPOSERY_PERSISTENCE`                                  | Selects the persistence engine: `auto` (default), `overlay`, or `copy`. `auto` probes the volume with a real overlay mount and uses `overlay` when it succeeds, falling back to `copy` otherwise. `overlay` names the kernel-maintained engine and needs a privileged container (`CAP_SYS_ADMIN`); when the probe cannot be satisfied it stops the container with the probe's own error rather than quietly running `copy`. `copy` is the universal engine and works on every target. An unsupported value stops the container with exit 64. See [Persistence](persistence.md#engines). |
| `COMPOSERY_COOKIE_SUFFIX`                                | Adds a cookie suffix, useful when sharing a parent domain across multiple Composery instances.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `COMPOSERY_RECONNECTION_GRACE_TIME`                      | Overrides reconnection grace time in seconds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `COMPOSERY_IDLE_TIMEOUT_SECONDS`                         | Asks the IDE to exit after an idle period. Both init systems restart it immediately, so it drops sessions rather than freeing the instance.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `COMPOSERY_DISABLE_GETTING_STARTED_OVERRIDE`             | Set to `1` or `true` to disable the IDE's Getting Started override.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `HTTPS_PROXY`, `https_proxy`, `HTTP_PROXY`, `http_proxy` | Sets an outbound HTTP(S) proxy for IDE update and extension-related requests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `LANG`                                                   | Overrides the locale. Defaults to `C.UTF-8`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## API

Composery serves a small [automation API](api.mdx) on the same port. It is off in
practice until you mint a key with `composery api key create`; with no keys, every
endpoint returns 401. The key store lives at `<volume>/api/keys.json`, on the persistent
volume shared with persistence (`/data` by default; see `COMPOSERY_DOCKER_VOLUME_PATH`).

| Variable                            | Default    | Use                                                                                                              |
| ----------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `COMPOSERY_DISABLE_API`             | unset      | Set to `1` or `true` to disable the API entirely (every endpoint returns 404).                                   |
| `COMPOSERY_API_TERMINAL_TIMEOUT`    | `60`       | Default timeout in seconds when `POST /_composery/api/v1/terminals` uses `wait: true`. The websocket is unbound. |
| `COMPOSERY_API_TERMINAL_MAX_OUTPUT` | `10485760` | Raw merged pty-output byte cap for a one-shot wait before truncation (10 MiB).                                   |
| `COMPOSERY_API_RATE_RPS`            | `50`       | Sustained requests per second per key.                                                                           |
| `COMPOSERY_API_RATE_BURST`          | `200`      | Burst request capacity per key.                                                                                  |
| `COMPOSERY_API_MAX_SESSIONS`        | `50`       | Concurrent one-shot waits and WebSocket terminal attachments per key.                                            |
| `COMPOSERY_API_AUTH_FAIL_PER_MIN`   | `20`       | Failed-auth attempts per minute per IP before throttling.                                                        |

Invalid numeric values fall back to the defaults. Extreme numeric values are
clamped to guardrail caps: 24h one-shot timeout, 64 MiB one-shot output, 1000 RPS,
10000 burst, 500 concurrent terminal streams, and 1000
failed-auth attempts/min/IP.

Rate limits are abuse rails, not DDoS defense - that is handled by the platform in front
of the instance.

## HTTP routes

The container includes Caddy as its single HTTP entrypoint. `/etc/caddy/Caddyfile` is its
complete, persistent configuration; it is not a generated file or a Composery-specific
fragment. The initial configuration keeps Composery's `/_composery` routes ahead of user
application routes and sends everything else to the IDE.

Add an application handler above the final IDE handler:

```text
handle /hooks/linear* {
	reverse_proxy 127.0.0.1:3000
}
```

Use Caddy's standard commands to check and apply changes in either runtime profile:

```sh
caddy validate --config /etc/caddy/Caddyfile
caddy reload --config /etc/caddy/Caddyfile
```

An invalid reload leaves the running configuration in place. An invalid configuration
at cold start prevents Caddy from starting, just as it would on a VPS. Composery never
replaces the file automatically.

This internal Caddy does not require Caddy at the outer edge. A VPS, ingress controller,
load balancer, tunnel, or another reverse proxy can publish port `8080` directly. The
Compose recipes that include a second Caddy use it only for public TLS and domains.
