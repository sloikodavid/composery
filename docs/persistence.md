---
title: Persistence
description: How Composery keeps your changes across restarts with the persistence daemon.
---

Composery is a container, but it should feel like a machine whose state survives
restarts. The `persistence` daemon compares the live root filesystem against an image
baseline and writes only your deltas to `/data/persistence`. Mounting one durable volume
at `/data` is the only hard requirement for [self-hosting](self-hosting/index.md).

## What persists

Persisted:

- regular files and directories;
- symlinks;
- hardlinks when the volume supports them;
- mode bits, ownership, and mtimes;
- xattrs, ACLs, and file capabilities, when supported by the kernel, mounted filesystem, and container privileges;
- FIFOs and device-node metadata, when supported by the mounted filesystem and container privileges;
- package manager state under paths such as `/usr`, `/etc`, and `/var/lib/dpkg`.

Excluded by default:

- `/data`;
- `/run`, `/var/run`, `/proc`, `/sys`, `/dev`, and `/tmp`;
- `/var/cache` (regenerable caches such as downloaded apt archives);
- `/opt/persistence` and `/opt/composery`;
- resolver and hostname files: `/etc/hosts`, `/etc/hostname`, `/etc/resolv.conf`.

For the systemd profile, keep `/etc/systemd`, `/var/lib/systemd`, and `/etc/machine-id`
persisted. Those paths store enabled units, service state, and machine identity; excluding
them would make Composery feel less like a VPS after restart.

Unix sockets are runtime endpoints and are ignored even outside excluded directories. The
owning process must recreate them after restart.

When a regular file still has the same bytes as the image but only metadata has changed -
mode, owner, mtime, or xattrs - Composery stores the metadata delta without copying the
full file into `changed/`. This keeps a touched large image file from ballooning the
`/data` volume.

The active config lives at `/data/persistence/config.json`. Self-hosters may edit the
exclusion list; invalid exclusion paths are rejected at startup.

## Commands

Inside the container:

```bash
sudo composery persistence status
sudo composery persistence status --json
sudo composery persistence doctor
sudo composery persistence prune
sudo composery persistence snapshot
```

## Snapshots

`composery persistence snapshot` captures a consistent point-in-time copy of the
persisted public truth (`config.json`, `changed/`, `removed/`, `metadata.jsonl`)
under `/data/persistence/.internal/snapshots/<id>`. It runs on the daemon's
single writer thread, so no delta update is in flight while it runs; `changed/`
and `removed/` are hardlinked (the daemon publishes them by atomic rename, so a
hardlink pins the point-in-time even as the box keeps changing). There is **no
box downtime** - code-server keeps serving while the snapshot is taken.

`state.sqlite` is intentionally excluded; it is derived and rebuilt on next
open. The command prints the snapshot directory (use `--json` for the path).
The caller owns archiving the directory and removing it afterward - to restore,
lay `config.json`, `changed/`, `removed/`, and `metadata.jsonl` back into
`/data/persistence`, remove `.internal/`, and restart so boot `apply` rebuilds
the rootfs from the restored delta.

## Readiness

Readiness is exposed through `/run/persistence/ready` and code-server's `/healthz` route.
If `composery persistence apply` fails during boot, code-server does not become ready.

## Hostname

The hostname is set by your container runtime, not the image - it is one of the
Docker-managed files Composery cannot persist. Set a stable one through your orchestrator:
`docker run --hostname ...`, Compose `hostname:`, or the equivalent.
