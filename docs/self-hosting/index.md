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
- never leave `COMPOSERY_REMOVE_PASSWORD` set after you have registered a new password
  (see [Forgotten password](#forgotten-password)) - it reopens the instance on every
  restart;
- keep the image [updated](#updating);
- do not expose port `8080` directly when a public Caddy/nginx/Traefik edge terminates TLS;
- back up the named Docker volume or the mounted `/data` disk before major upgrades.

## Forgotten password

Two ways back in, both through your target's environment variables. Neither needs the
volume.

**Prefer `COMPOSERY_PASSWORD`.** Set it and restart: it overrides the registered password
and keeps overriding it for as long as it stays set. The instance is never left open, so
there is no window to get wrong.

The other way removes the password instead, and it is the dangerous one.

### COMPOSERY_REMOVE_PASSWORD leaves your instance wide open

Set `COMPOSERY_REMOVE_PASSWORD=true` and restart, and the registered password is deleted. The
instance then behaves exactly like a brand new one: the next person to load the URL is
handed the "create password" screen. **That person does not have to be you.** Whoever
registers first owns the instance, and a Composery instance is a root-capable machine with
a terminal, your files, and your credentials on it.

It runs on **every boot while the variable is set**, not once. Each restart removes the
password again - including restarts you did not ask for, such as host reboots, platform
redeploys, and node migrations. An instance you believe you re-secured can be silently
returned to open weeks later.

Use it like this, and do not stop after step 2:

1. Set `COMPOSERY_REMOVE_PASSWORD=true` only when you can open the instance _right now_.
2. Restart, open it immediately, and register the new password.
3. **Set `COMPOSERY_REMOVE_PASSWORD=false` (or remove it entirely) and restart again.** Until
   you do, you are one restart away from an unprotected instance.

Only `1` and `true` turn it on, trimmed and case-insensitive. Every other value - `0`,
`false`, empty, or a typo - leaves the registered password alone, so a mistake fails
towards staying protected. The container logs a warning on every boot it is active, and a
separate note if `COMPOSERY_PASSWORD` is also set and still governs sign-in.
