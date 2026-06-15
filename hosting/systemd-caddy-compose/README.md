# Composery with systemd and Caddy

This example runs Composery behind Caddy with automatic HTTPS and starts the
runtime with systemd as PID 1. It is the closest self-hosted shape to Composery
Cloud on a Hetzner-style VPS.

## Prerequisites

- a Linux host with Docker Compose;
- a domain or subdomain pointing at the host;
- inbound TCP ports `80` and `443` open;
- permission to run a privileged container with host cgroup access.

Use [../supervisor-caddy-compose](../supervisor-caddy-compose/) if the host cannot
provide privileged containers, cgroups, or tmpfs mounts.

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

The runtime env file is mounted at `/etc/composery/composery.env`. The container
entrypoint reads it before selecting an init profile, and systemd reads the same
file for the Composery service. Keep `COMPOSERY_INIT=systemd` and
`container=docker` in that file. Quote values containing `$`, such as
`HASHED_PASSWORD`.

Composery state is stored in the `composery_data` Docker volume. Systemd service
state under `/etc/systemd`, package state under `/var/lib`, and the machine id are
persisted by `persistd`; runtime paths such as `/run`, `/tmp`, `/sys`, and `/dev`
stay excluded.

## Operations

```bash
docker compose exec composery systemctl status composery persistd
docker compose exec composery journalctl -u composery -u persistd --no-pager
```

## Upgrade

```bash
docker compose pull
docker compose up -d
```

Back up `composery_data` before major upgrades.
