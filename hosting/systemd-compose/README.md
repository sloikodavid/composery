# Composery with systemd and no bundled proxy

This example runs Composery with systemd as PID 1 - the closest shape to Composery
Cloud - but publishes its HTTP port directly instead of bundling Caddy. Use it on a
privileged host where you already terminate TLS with your own reverse proxy (nginx,
Traefik, a Cloudflare Tunnel, or a platform edge).

If you want Composery to own its HTTPS edge, use [../systemd-caddy-compose](../systemd-caddy-compose/).
If the host cannot provide privileged containers, cgroups, or tmpfs mounts, use
[../supervisor-compose](../supervisor-compose/).

## Prerequisites

- a Linux host with Docker Compose;
- permission to run a privileged container with host cgroup access;
- a way to reach port `8080` (directly on a trusted network, or through your proxy).

## Run

```bash
# optionally edit composery.env to pre-register a password
docker compose up -d
```

Open `http://<host>:8080`.

On first visit, register the initial Composery password in the browser if you didn't
already set `PASSWORD` or `HASHED_PASSWORD` in `composery.env`. Single-quote values
containing `$`, such as `HASHED_PASSWORD`. systemd as PID 1 is selected by
`COMPOSERY_INIT=systemd` in `compose.yml`.

## Security

This example serves plaintext HTTP. Do not expose port `8080` to the public internet
without TLS in front of it. Either put a reverse proxy that terminates HTTPS in front
of `8080`, or bind the port to localhost only (`"127.0.0.1:8080:8080"` in `compose.yml`)
and route to it from your proxy on the same host.

Composery state is stored in the `composery_data` Docker volume.

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
