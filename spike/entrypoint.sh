#!/usr/bin/env bash
# Prototype overlay-root entrypoint --- a SPIKE PROBE, not production code.
#
# Constructs an overlayfs whose lower is the image rootfs (the container's own
# Docker overlay "/"), whose upper+work live in a reserved subtree of the /data
# volume, moves the kernel API filesystems and the volume into the merged tree,
# pivot_roots into it, and execs systemd as PID 1. This mirrors the future
# production boot path closely enough to prove or kill the mechanics.
#
# Env knobs (spike only):
#   OVERLAY_LOWER_MODE=direct|bind   direct: lowerdir=/  bind: ro bind of / first
#   OVERLAY_PROBE_ONLY=1             mount the overlay, report, exit (no pivot)
#   OVERLAY_DATA_DIR=/data           durable volume mountpoint
set -euo pipefail

log() { printf '[overlay-root] %s\n' "$*" >&2; }

DATA="${OVERLAY_DATA_DIR:-/data}"
RESERVED="$DATA/persistence/overlay"
UPPER="$RESERVED/upper"
WORK="$RESERVED/work"
SCRATCH=/mnt/overlay-root # tmpfs, discarded at pivot
MERGED="$SCRATCH/merged"
LOWER_MODE="${OVERLAY_LOWER_MODE:-direct}"
LOWER=/

# Upper persists across boots; work is pure scratch a hard-killed previous
# container can leave dirty, so recreate it fresh.
mkdir -p "$UPPER"
rm -rf "$WORK"
mkdir -p "$WORK"

# Private propagation: keeps our mount moves from escaping to the host and
# satisfies pivot_root's "not shared" requirement.
mount --make-rprivate /

# Scratch tmpfs for the mountpoint(s): keeps the overlay mountpoint and the bind
# staging dir off both the image rw layer and the persistent upper.
mkdir -p "$SCRATCH"
mount -t tmpfs tmpfs "$SCRATCH"
mkdir -p "$MERGED"

if [ "$LOWER_MODE" = bind ]; then
	LOWER="$SCRATCH/lower"
	mkdir -p "$LOWER"
	mount --bind / "$LOWER"
	mount -o remount,bind,ro "$LOWER"
fi

log "root fstype (the overlay lower is itself this): $(findmnt -no FSTYPE / || true)"
log "mount overlay: lower=$LOWER mode=$LOWER_MODE upper=$UPPER -> $MERGED"

if ! mnt_err=$(mount -t overlay overlay-spike \
	-o "lowerdir=$LOWER,upperdir=$UPPER,workdir=$WORK" "$MERGED" 2>&1); then
	rc=$?
	log "OVERLAY_MOUNT_FAILED rc=$rc"
	log "OVERLAY_MOUNT_ERR: $mnt_err"
	dmesg 2>/dev/null | tail -n 5 | sed 's/^/[overlay-root][dmesg] /' >&2 || true
	exit "$rc"
fi
log "OVERLAY_MOUNT_OK"

if [ "${OVERLAY_PROBE_ONLY:-0}" = 1 ]; then
	log "probe-only: overlay mounted, not pivoting."
	findmnt -no SOURCE,TARGET,FSTYPE "$MERGED" >&2 || true
	exit 0
fi

# The overlay lower is a plain directory tree: mounts stacked on "/" (proc, sys,
# dev, run, tmp, the /data volume, and cgroup under /sys) are invisible through
# it. Move them into the merged tree before pivoting.
for m in /proc /sys /dev /run /tmp "$DATA"; do
	mkdir -p "$MERGED$m"
done
mount --rbind /proc "$MERGED/proc"
mount --rbind /sys "$MERGED/sys" # carries /sys/fs/cgroup (rw, cgroup:host)
mount --rbind /dev "$MERGED/dev"
mount --rbind /run "$MERGED/run"
mount --rbind /tmp "$MERGED/tmp"
mount --rbind "$DATA" "$MERGED$DATA" # durable volume; upper is a subtree of it

log "merged tree mounts before pivot:"
findmnt -o TARGET,SOURCE,FSTYPE -R "$MERGED" >&2 || true

# Pivot into the merged overlay and detach the old container root.
mkdir -p "$MERGED/mnt/oldroot"
cd "$MERGED"
pivot_root . mnt/oldroot
cd /
mount --make-rprivate /mnt/oldroot 2>/dev/null || true
umount -l /mnt/oldroot || true

log "pivot complete; root is the overlay. exec systemd as PID 1."
exec /lib/systemd/systemd
