---
title: Self-Hosting
description: Deploy Composery with one container, one persistent /data volume, and one HTTP edge.
---

Every Composery deployment is the same shape: **one container, one persistent volume at
`/data`, one HTTP edge.** The [persistence](../persistence.md) daemon rebuilds the root
filesystem from `/data` on boot, so the only hard requirement is a writable disk mounted
there. Composery cannot externalize its state to a managed database, so platforms with an
ephemeral filesystem and no attachable disk are [not viable](#not-viable).

## Choose a target

Run on your own server, or on a managed platform that supplies the HTTPS edge and a disk:

- **[Docker Compose on a VPS](vps.md)** - your own Linux server. Pick the init system.
  (`systemd` or `supervisor`) and whether Composery owns its TLS edge (bundled Caddy or
  your own proxy).
- **[Fly.io](fly.md)** - `fly.toml` with one volume.
- **[Render](render.md)** - `render.yaml` Blueprint with a persistent disk.
- **[Railway](railway.md)** - image service with a volume at `/data`.
- **[Kubernetes](kubernetes.md)** - one replica, a PVC at `/data`, Service, and Ingress.

## Not viable

Composery needs a persistent `/data` and cannot fall back to a managed database, so it is
**not** a fit for platforms whose container filesystem is ephemeral with no attachable disk:

- **Heroku** - dynos cycle daily and lose the filesystem.
- **DigitalOcean App Platform** - no volumes; local disk is ephemeral. Use a Droplet.
- **Google Cloud Run / App Engine** - stateless. Use a GCE VM.
- **AWS App Runner / ECS Fargate (default)** - stateless without EFS. Use EC2, or mount.
  EFS at `/data` (advanced).
- **Azure Container Apps** - needs an Azure Files share mounted at `/data`, or use a VM.

## Hardening

Whatever target you pick, treat the browser password and reverse proxy as the security
boundary - Composery is intentionally root-capable inside the container:

- use HTTPS;
- register a strong password, or set `PASSWORD` / `HASHED_PASSWORD`.
  (see [Configuration](../configuration.md));
- keep the image updated;
- do not expose port `8080` directly when a public Caddy/nginx/Traefik edge terminates TLS;
- back up the named Docker volume or the mounted `/data` disk before major upgrades.
