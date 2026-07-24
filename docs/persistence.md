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

## Engines

Persistence has two engines behind one contract, selected by `COMPOSERY_PERSISTENCE`
(`auto` by default):

- **copy** — the universal engine, and the only one that works on managed PaaS that
  cannot grant container privileges (Render, Railway, Koyeb, and similar). A userspace
  daemon compares the live root filesystem against the image baseline and writes only your
  deltas to `/data/persistence`. Its observation cost is bounded by construction (see
  [Bounded observation](#bounded-observation)).
- **overlay** — a kernel-maintained engine that makes the root filesystem an overlayfs
  whose upper layer lives on the `/data` volume, so the kernel records the delta directly.
  It needs a privileged container (`CAP_SYS_ADMIN`). _Not yet available_: `auto` resolves
  to the copy engine, and an explicit `COMPOSERY_PERSISTENCE=overlay` stops the container
  rather than pretending.

What is identical across engines: one durable volume at `/data`, the same delta model, the
same image-upgrade promise (a new image ships a new baseline/lower, your changes stay on
top, every file you never touched moves to the new version), and the same integrity
boundary — the paths under [What persists](#what-persists) are never captured either way.
What differs is only _how_ the delta is maintained: a userspace daemon under copy, the
kernel under overlay. `auto` probes by attempting a real overlay mount on the `/data`
volume and falls back to copy on any failure; `composery persistence status` reports the
selected engine and the reason it was chosen.

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

`/var/cache` is also excluded by default because it holds regenerable caches such as
downloaded apt archives. Unlike the integrity exclusions above, this is a default the image
ships rather than an unremovable rule: list it under `persist` in `config.json` to keep it,
and a future image can change the default set without rewriting your volume.

For the systemd profile, keep `/etc/systemd`, `/var/lib/systemd`, and `/etc/machine-id`
persisted. Those paths store enabled units, service state, and machine identity; excluding
them would make Composery feel less like a VPS after restart.

Unix sockets are runtime endpoints and are ignored even outside excluded directories. The
owning process must recreate them after restart.

When a regular file still has the same bytes as the image but only metadata has changed -
mode, owner, mtime, or xattrs - Composery stores the metadata delta without copying the
full file into `changed/`. This keeps a touched large image file from ballooning the
`/data` volume.

The active config lives at `/data/persistence/config.json` and records only your intent,
never the built-in policy. Two symmetric arrays: `exclude` adds paths to the boundary, and
`persist` keeps a path the image excludes by default (it can never override an integrity
exclusion). A new config contains neither — the image owns the default set, so a future
image can change it — alongside an `audit` block and a `maxWatches` cap. The effective
exclusion set is the integrity set, plus the image defaults you did not `persist`, plus
whatever you `exclude`. Older single-`exclusions` configs are migrated forward on first
boot and the change is logged, dropping the `/var/cache` entry that was indistinguishable
from the old baked-in default so the current image governs it. If the file is malformed or
contains an invalid value, it is preserved beside the original as `config.invalid-N.json`
and replaced with safe defaults, so a configuration typo cannot prevent the IDE from
starting. Storage or filesystem-integrity failures still stop boot rather than pretending
the durable state was applied.

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
