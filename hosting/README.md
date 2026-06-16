# Hosting Composery

Every Composery deployment is the same shape: **one container, one persistent volume
at `/data`, one HTTP edge.** `persistd` rebuilds the root filesystem from `/data` on
boot, so the only hard requirement is a writable disk mounted there. Composery cannot
externalize its state to a managed database, so platforms with an ephemeral filesystem
and no attachable disk are not viable (see [Not viable](#not-viable) below).

Pick an example along two axes:

- **Init** - use `systemd` when the host allows privileged containers and host cgroups.
  (the cloud-parity shape); fall back to `supervisor` when it cannot.
- **TLS edge** - bundle **Caddy** for automatic HTTPS when Composery owns the domain,
  or run with **no proxy** when a platform or your own reverse proxy terminates TLS.

## Compose examples

|                           | Bundled Caddy (Composery owns TLS)                             | No proxy (platform / your own proxy)                                         |
| ------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **systemd** (privileged)  | [systemd-caddy-compose](systemd-caddy-compose/) - cloud parity | [systemd-compose](systemd-compose/)                                          |
| **supervisor** (any host) | [supervisor-caddy-compose](supervisor-caddy-compose/)          | [supervisor-compose](supervisor-compose/) - also the `docker run` quickstart |

If you are unsure: a Hetzner/DigitalOcean-style VPS with a domain wants
[systemd-caddy-compose](systemd-caddy-compose/); a locked-down or rootless Docker host
with a domain wants [supervisor-caddy-compose](supervisor-caddy-compose/).

## Managed platforms (PaaS)

These platforms provide the HTTPS edge and a persistent disk, so Composery runs as a
single supervisor container with one volume at `/data`:

- [render](render/) - `render.yaml` Blueprint (Docker image + persistent disk).
- [fly](fly/) - `fly.toml` with one volume.
- [railway](railway/) - `railway.json` plus deploy/template instructions.

## Kubernetes

- [kubernetes](kubernetes/) - one replica, a `PersistentVolumeClaim` at `/data`, a.
  `Service`, and an example `Ingress`.

## Not viable

Composery needs a persistent `/data` and cannot fall back to a managed database, so it
is **not** a fit for platforms whose container filesystem is ephemeral with no
attachable disk:

- **Heroku** - dynos cycle daily and lose the filesystem.
- **DigitalOcean App Platform** - no volumes; local disk is ephemeral. Use a Droplet.
  with a Compose example instead.
- **Google Cloud Run / App Engine** - stateless. Use a GCE VM with a Compose example.
- **AWS App Runner / ECS Fargate (default)** - stateless without EFS. Use EC2 with a.
  Compose example, or mount EFS at `/data` (advanced).
- **Azure Container Apps** - needs an Azure Files share mounted at `/data`, or use a VM.

See [../docs/self-hosting.md](../docs/self-hosting.md) for the deployment-target table,
the persistence contract, runtime environment variables, and operational notes.
