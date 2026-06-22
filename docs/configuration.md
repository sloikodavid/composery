---
title: Configuration
description: Runtime environment variables for Composery.
---

Composery does not wrap upstream runtime settings - you configure it with environment
variables. In the Compose examples, set them in `composery.env`; Compose loads that file
into the container (`env_file`). Other hosting providers use their own environment-variable
UI.

The init system is selected by `COMPOSERY_INIT`, set in the compose service's
`environment:` block (not in `composery.env`). The default is `supervisor`, or `systemd`
on hosts with privileged containers and host cgroups.

## Common variables

| Variable                           | Use                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `PASSWORD`                         | Sets a plaintext code-server password and skips first-visit registration.                                                           |
| `HASHED_PASSWORD`                  | Sets an argon2 hashed password and takes precedence over `PASSWORD`. Single-quote values containing `$` in `composery.env`.         |
| `PORT`                             | Changes code-server's listen port. Also update Caddy, `expose`, health checks, or platform routing if you change it from `8080`.    |
| `VSCODE_PROXY_URI`                 | Controls links in the Ports panel, e.g. `https://{{port}}.dev.example.com`. The default path proxy works without setting this.      |
| `COMPOSERY_DISABLE_FILE_DOWNLOADS` | Set to `1` or `true` to block browser file downloads.                                                                               |
| `COMPOSERY_DISABLE_PROXY`          | Set to `1` or `true` to disable code-server's port proxy routes.                                                                    |
| `EXTENSIONS_GALLERY`               | Points code-server at a custom VS Code Extension Gallery API using the JSON shape expected by VS Code `product.json`.               |
| `LOG_LEVEL`                        | Sets code-server logging to `trace`, `debug`, `info`, `warn`, or `error`.                                                           |
| `GITHUB_TOKEN`                     | Supplies code-server's GitHub auth token. Treat it as a secret; code-server removes it from the child-process environment at start. |

## Less common

| Variable                                                 | Use                                                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `COMPOSERY_CONFIG`                                       | Overrides the code-server YAML config path.                                                        |
| `COMPOSERY_HOST`                                         | Overrides the bind host. Avoid setting this unless you understand the container networking impact. |
| `COMPOSERY_COOKIE_SUFFIX`                                | Adds a cookie suffix, useful when sharing a parent domain across multiple code-server instances.   |
| `COMPOSERY_RECONNECTION_GRACE_TIME`                      | Overrides reconnection grace time in seconds.                                                      |
| `COMPOSERY_IDLE_TIMEOUT_SECONDS`                         | Asks code-server to exit after an idle period. Supervisor restarts code-server, so use with care.  |
| `COMPOSERY_DISABLE_GETTING_STARTED_OVERRIDE`             | Set to `1` or `true` to disable code-server's Getting Started override.                            |
| `HTTPS_PROXY`, `https_proxy`, `HTTP_PROXY`, `http_proxy` | Sets an outbound HTTP(S) proxy for code-server update and extension-related requests.              |
| `LANG`                                                   | Overrides the locale. Defaults to `C.UTF-8`.                                                       |
