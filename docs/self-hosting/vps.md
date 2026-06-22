---
title: Docker Compose on a VPS
description: Self-host Composery on your own Linux server with Docker Compose.
---

Run Composery on any Docker-capable Linux server. You choose two things: the **init**
system, and whether Composery **owns its TLS edge**.

- **Init** - `systemd` runs as PID 1 (the closest shape to Composery Cloud; needs a.
  privileged container with host cgroup access) or `supervisor` (works on any host,
  including rootless or locked-down ones). Selected by `COMPOSERY_INIT` in `compose.yml`.
- **TLS** - bundle **Caddy** for automatic HTTPS when Composery owns the domain, or run.
  with **no proxy** when your own reverse proxy or a platform terminates TLS.

That gives four recipes:

| Recipe                                                                                                    | When                                                                           |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [systemd + Caddy](https://github.com/sloikodavid/composery/tree/main/hosting/systemd-caddy-compose)       | Recommended VPS - Hetzner/DigitalOcean-style host with a domain. Cloud parity. |
| [systemd, no proxy](https://github.com/sloikodavid/composery/tree/main/hosting/systemd-compose)           | Privileged host where your own proxy terminates TLS.                           |
| [supervisor + Caddy](https://github.com/sloikodavid/composery/tree/main/hosting/supervisor-caddy-compose) | Locked-down or rootless host with a domain.                                    |
| [supervisor, no proxy](https://github.com/sloikodavid/composery/tree/main/hosting/supervisor-compose)     | Quick trial, or behind your own proxy. Also the `docker run` quickstart.       |

If unsure: a VPS with a domain wants a **Caddy** variant; use **systemd** when the host
allows privileged containers and host cgroups, otherwise **supervisor**.

## Deploy (Caddy variants)

1. Point DNS `A`/`AAAA` records at the server; open inbound TCP `80` and `443`.
2. Install Docker Compose.
3. Copy the recipe folder, then edit `Caddyfile` (your domain) and, optionally,
   `composery.env` (pre-register a password).
4. `docker compose up -d`.

Open `https://<your-domain>`.

## Deploy (no-proxy variants)

```bash
docker compose up -d
```

This serves plaintext HTTP on `8080`. Do not expose it to the public internet without TLS
in front - either put a reverse proxy that terminates HTTPS ahead of `8080`, or bind it to
localhost only (`"127.0.0.1:8080:8080"` in `compose.yml`) and route from your proxy.

For a one-off trial without Compose:

```bash
docker run -d --name composery -p 8080:8080 -v composery_data:/data \
  ghcr.io/sloikodavid/composery:latest
```

## Notes

- systemd variants require a privileged container with host cgroup access.
- State is stored in the `composery_data` Docker volume; Caddy certificate state in.
  `caddy_data`.
- Register the initial password in the browser on first visit, or set `PASSWORD` /.
  `HASHED_PASSWORD` in `composery.env` (single-quote values containing `$`). See
  [Configuration](../configuration.md).
- Upgrade with `docker compose pull && docker compose up -d`. Back up `composery_data`.
  before major upgrades.
