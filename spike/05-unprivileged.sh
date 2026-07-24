#!/usr/bin/env bash
# Q5 --- unprivileged failure shape. The future boot probe must detect a target
# that cannot build the overlay root and fall back to the userspace engine, so
# it needs the EXACT errno of the overlay mount attempt with no privileges.
#
# (A) shows what the naive overlay entrypoint does when run unprivileged.
# (B) is the isolated capability probe (what the real auto-probe should run):
#     the overlay mount with a VALID upperdir (ext4, on /data) so the only
#     variable is privilege. errno is read via LIBMOUNT_DEBUG (no ptrace, which
#     the default seccomp profile blocks in an unprivileged container).
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh

trap 'cleanup_containers; docker volume rm "$VOLUME" >/dev/null 2>&1 || true' EXIT

log "build image"
build_image "$IMAGE" 1
fresh_volume

log "A) real entrypoint, UNPRIVILEGED plain \`docker run\` (probe-only, no pivot)"
set +e
docker run --rm --name overlay-spike-unpriv \
	-e OVERLAY_PROBE_ONLY=1 -e OVERLAY_LOWER_MODE=direct \
	-v "${VOLUME}:/data" "$IMAGE"
rc=$?
set -e
echo "entrypoint exit code (unprivileged): $rc"
echo "(it dies at the first privileged mount op --- do NOT run the overlay entrypoint unprivileged)"

# Isolated capability probe. upper+work on the ext4 /data volume (a valid
# upperdir); only privilege varies. LIBMOUNT_DEBUG surfaces the syscall + errno.
probe='D=/data/persistence/overlay; mkdir -p "$D/upper" "$D/work" /tmp/lower /tmp/merged
LIBMOUNT_DEBUG=all mount -t overlay overlay-probe \
	-o lowerdir=/tmp/lower,upperdir=$D/upper,workdir=$D/work /tmp/merged 2>/tmp/dbg
echo "mount exit=$?"
grep -iE "syscall .(fsopen|fsmount|move_mount).|errno=|not permitted|denied" /tmp/dbg | tail -n 4
umount /tmp/merged 2>/dev/null || true'

log "B) isolated overlay-mount probe --- UNPRIVILEGED (the fallback trigger)"
docker run --rm --entrypoint sh -v "${VOLUME}:/data" "$IMAGE" -c "$probe" || true

log "B) isolated overlay-mount probe --- PRIVILEGED (contrast: succeeds)"
docker run --rm --privileged --entrypoint sh -v "${VOLUME}:/data" "$IMAGE" -c "$probe" || true

echo
echo "RESULT: with no CAP_SYS_ADMIN the overlay mount fails at fsopen() with EPERM"
echo "        (errno 1, 'Operation not permitted'; mount(8) exit 32). Privileged with an"
echo "        ext4 upper succeeds. A one-shot mount probe is a reliable engine selector."
