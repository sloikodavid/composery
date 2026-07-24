---
title: Persistence
description: How Composery keeps your changes across restarts with the persistence daemon.
---

Composery is a container, but it should feel like a machine whose state survives
restarts. The `persistence` daemon compares the live root filesystem against an image
baseline and writes only your deltas to `/data/persistence`. Mounting one durable volume
at `/data` is the only hard requirement for [self-hosting](self-hosting/index.md).

The same delta model is what makes image upgrades safe: a new image ships a new baseline,
your deltas re-apply on top, and every file you never touched moves to the new version. See
[Updating](self-hosting/index.md#updating) for the procedure.

`/data` is owned by the normal `user` account and is the direct durable disk. Put
databases, object stores, large build artifacts, and other high-volume state there. Files
under `/data` occupy the volume once. Files elsewhere still behave like ordinary machine
files, but a changed file occupies both the container's writable layer and its durable
delta copy; a 10 GB changed file outside `/data` therefore consumes roughly 20 GB of the
host disk. `df -h /data` shows the durable disk's ordinary filesystem usage.

The volume must be a normal block-backed Linux filesystem (ext4, xfs, btrfs, or a Docker
named volume). Network filesystems such as NFS are not supported: persistence relies on
file locking, atomic renames, and xattrs that NFS does not reliably provide.

## What persists

Persisted:

- regular files and directories;
- symlinks;
- hardlinks when the volume supports them;
- mode bits, ownership, and mtimes;
- xattrs, ACLs, and file capabilities, when supported by the kernel, mounted filesystem, and container privileges;
- FIFOs and device-node metadata, when supported by the mounted filesystem and container privileges;
- package manager state under paths such as `/usr`, `/etc`, and `/var/lib/dpkg`.

Always excluded because they are runtime state, container-managed files, or the
update-owned Composery implementation:

- `/data`;
- `/run`, `/var/run`, `/proc`, `/sys`, `/dev`, and `/tmp`;
- `/opt/persistence` and `/opt/composery`;
- resolver and hostname files: `/etc/hosts`, `/etc/hostname`, `/etc/resolv.conf`.

`/var/cache` is also excluded by default because it contains regenerable caches such as
downloaded apt archives. Unlike the integrity exclusions above, this is an ordinary
user-configurable exclusion.

For the systemd profile, keep `/etc/systemd`, `/var/lib/systemd`, and `/etc/machine-id`
persisted. Those paths store enabled units, service state, and machine identity; excluding
them would make Composery feel less like a VPS after restart.

Unix sockets are runtime endpoints and are ignored even outside excluded directories. The
owning process must recreate them after restart.

When a regular file still has the same bytes as the image but only metadata has changed -
mode, owner, mtime, or xattrs - Composery stores the metadata delta without copying the
full file into `changed/`. This keeps a touched large image file from ballooning the
`/data` volume.

The active config lives at `/data/persistence/config.json`. Its `exclusions` array adds
paths to the built-in boundary above; a new config contains only `/var/cache`, so it does
not repeat settings that cannot be changed. If the file is malformed or contains an
invalid value, it is preserved beside the original as `config.invalid-N.json` and replaced
with safe defaults. A configuration typo therefore cannot prevent the IDE from starting.
Storage or filesystem-integrity failures still stop boot rather than pretending the
durable state was applied.

## Bounded observation

The live inotify watcher is a latency optimisation, not the source of truth: the rolling
audit is the recovery floor. So the watcher's cost is capped by construction rather than
allowed to scale with the workload. It watches at most `maxWatches` directories (8192 by
default, tunable in `config.json`) and evicts the least-recently-active watch when full;
the dirty-change queue between the watcher and the writer is likewise bounded and sheds
under sustained pressure. Neither `/var/lib/docker` overlay churn nor a `node_modules`
storm can grow the daemon's memory. Anything not currently watched - trees past the budget,
or under a saturated queue - is still recovered by the next audit pass, at most one audit
interval later. Both the watcher and the audit also stop at mount boundaries: a bind-mounted
volume or a container runtime's overlay tree is runtime-managed, not part of the image, so
it is neither watched nor audited. `composery persistence status` reports the active watch
count, the budget, cumulative evictions, and whether the watcher has shed to audit-only.

## Commands

Inside the container:

```bash
sudo composery persistence status
sudo composery persistence status --json
sudo composery persistence doctor
sudo composery persistence prune
```

## Readiness

Readiness is exposed through `/run/persistence/ready` and `/_composery/healthz`.
If `composery persistence apply` fails during boot, the IDE does not become ready.

## Hostname

The hostname is set by your container runtime, not the image - it is one of the
Docker-managed files Composery cannot persist. Set a stable one through your orchestrator:
`docker run --hostname ...`, Compose `hostname:`, or the equivalent.
