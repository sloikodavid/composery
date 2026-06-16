# Composery with supervisor and no bundled proxy

This example runs Composery as a single container with the default supervisor init
and publishes its HTTP port directly. Use it as a quick trial, or when you already
terminate TLS with your own reverse proxy (nginx, Traefik, a Cloudflare Tunnel, or a
platform edge).

For a managed PaaS with a persistent disk, prefer the ready-made templates in
[../render](../render/), [../fly](../fly/), or [../railway](../railway/). For a VPS
where Composery should own its HTTPS edge, use [../supervisor-caddy-compose](../supervisor-caddy-compose/).

## Prerequisites

- a Docker host with Docker Compose;
- a way to reach port `8080` (directly on a trusted network, or through your proxy).

## Run

```bash
# optionally edit composery.env to pre-register a password
docker compose up -d
```

Open `http://<host>:8080`.

For a one-off trial without Compose:

```bash
docker run -d --name composery -p 8080:8080 -v composery_data:/data \
  ghcr.io/sloikodavid/composery:latest
```

On first visit, register the initial Composery password in the browser if you didn't
already set `PASSWORD` or `HASHED_PASSWORD` in `composery.env`. To pin a specific image
version, replace the `composery` image tag in `compose.yml` with the version or digest
you want to run. Single-quote values containing `$`, such as `HASHED_PASSWORD`.

## Security

This example serves plaintext HTTP. The browser password is the only boundary, so do
not expose port `8080` to the public internet without TLS in front of it. Either:

- put a reverse proxy that terminates HTTPS in front of `8080`; or.
- bind the port to localhost only (`"127.0.0.1:8080:8080"` in `compose.yml`) and route.
  to it from your proxy on the same host.

Composery state is stored in the `composery_data` Docker volume.

## Upgrade

```bash
docker compose pull
docker compose up -d
```

Back up `composery_data` before major upgrades.
