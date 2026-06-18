# Composery with supervisor and Caddy

This example runs Composery behind Caddy with automatic HTTPS and the default
supervisor init.

## Prerequisites

- a Linux host with Docker Compose;
- a domain or subdomain pointing at the host;
- inbound TCP ports `80` and `443` open.

## Run

```bash
# edit Caddyfile and replace example.com with your domain
# optionally edit composery.env to pre-register a password
docker compose up -d
```

Open `https://<your-domain>`.

On first visit, register the initial Composery password in the browser if you
didn't already set `PASSWORD` or `HASHED_PASSWORD` in `composery.env`. To pin a
specific image version, edit `compose.yml` and replace the `composery` image tag
with the version or digest you want to run.

Set code-server variables in `composery.env` when you need them; Compose loads it
into the container. For example, set `PASSWORD` to use an environment-managed password
instead of first-visit registration. Single-quote values containing `$`, such as
`HASHED_PASSWORD`.

Composery state is stored in the `composery_data` Docker volume. Caddy certificate
state is stored in `caddy_data`. Caddy's `/config` autosave is regenerated from the
`Caddyfile` on every start, so it is not persisted.

Use [../systemd-caddy-compose](../systemd-caddy-compose/) when you want a
host-integrated Linux VPS shape with `systemctl`, service units, and journald.

## Upgrade

```bash
docker compose pull
docker compose up -d
```

Back up `composery_data` before major upgrades.
