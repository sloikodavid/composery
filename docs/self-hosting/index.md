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

- **[Docker Compose on a VPS](vps.md)** - your own Linux server. Pick the init system
  (`systemd` or `supervisor`) and whether Composery owns its TLS edge (bundled Caddy or
  your own proxy).
- **[DigitalOcean](digitalocean.md)** - a Droplet with a compose recipe (the common n8n
  path), or DOKS. Not App Platform.
- **[Fly.io](fly.md)** - `fly.toml` with one volume.
- **[Render](render.md)** - `render.yaml` Blueprint with a persistent disk.
- **[Railway](railway.md)** - image service with a volume at `/data`.
- **[Koyeb](koyeb.md)** - image service with a volume at `/data` (single-instance regions).
- **[Kubernetes](kubernetes.md)** - one replica, a PVC at `/data`, Service, and Ingress.
- **[Other PaaS & self-hosted platforms](paas.md)** - Coolify, Dokploy, CapRover, Northflank,
  Sliplane, PikaPods, Elestio, and any host that runs a container image with a volume at
  `/data`.

## Not viable

Composery needs a persistent `/data` and cannot fall back to a managed database, so it is
**not** a fit for platforms whose container filesystem is ephemeral with no attachable disk:

- **Heroku** - dynos cycle daily and lose the filesystem.
- **DigitalOcean App Platform** - no volumes; local disk is ephemeral. Use a
  [Droplet](vps.md) or [DOKS](kubernetes.md) instead.
- **Google Cloud Run / App Engine** - stateless. Use a GCE VM.
- **AWS App Runner / ECS Fargate (default)** - stateless without EFS. Use EC2, or mount
  EFS at `/data` (advanced).
- **Azure Container Apps** - needs an Azure Files share mounted at `/data`, or use a VM.

## Updating

Composery ships as a single rolling image; there is no migration step to run on upgrade.
The [persistence](../persistence.md) daemon re-applies your saved deltas over each new
image's baseline on boot, so an upgrade keeps your state:

- your `/data` volume is never touched by an upgrade;
- files you changed keep your version;
- files you removed stay removed;
- every system file you never touched moves to the new image's version automatically.

Upgrade by pulling the new image and recreating the container from the same volume. With
Docker Compose:

```bash
docker compose pull
docker compose up -d
```

Other targets do the same thing their own way: redeploy or restart the service so it pulls
the new image while keeping the `/data` volume attached.

Choose how eagerly you take upgrades with the image tag:

- `ghcr.io/sloikodavid/composery:latest` - always the newest stable release (the default in
  every recipe here);
- `ghcr.io/sloikodavid/composery:0.1` - the latest patch of one minor line, with no surprise
  minor or major jumps;
- `ghcr.io/sloikodavid/composery:0.1.0` - an exact build that changes only when you change
  the tag.

Back up the `/data` volume before a major upgrade. Your changes are stored as deltas against
the image baseline, so a volume backup is the clean way back if a major jump does not suit
you.

## Hardening

Whatever target you pick, treat the browser password and reverse proxy as the security
boundary - Composery is intentionally root-capable inside the container:

- use HTTPS;
- register a strong password, or set `COMPOSERY_PASSWORD` /
  `COMPOSERY_HASHED_PASSWORD`
  (see [Configuration](../configuration.md));
- keep the image [updated](#updating);
- do not expose port `8080` directly when a public Caddy/nginx/Traefik edge terminates TLS;
- back up the named Docker volume or the mounted `/data` disk before major upgrades.
