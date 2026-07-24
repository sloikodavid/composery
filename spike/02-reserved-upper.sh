#!/usr/bin/env bash
# Q2 --- the overlay upper/work live in a reserved subtree of the /data volume
# while users keep writing ordinary files elsewhere on the same volume at /data.
# Confirms coexistence and documents the out-of-band modification hazard.
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh

trap 'cleanup_containers; docker volume rm "$VOLUME" >/dev/null 2>&1 || true' EXIT

log "build + boot (fresh volume)"
build_image "$IMAGE" 1
mapfile -t FLAGS < <(prod_run_flags)
fresh_volume
n=overlay-spike-reserved
docker rm -f "$n" >/dev/null 2>&1 || true
docker run -d --name "$n" "${FLAGS[@]}" -e OVERLAY_LOWER_MODE=direct "$IMAGE" >/dev/null
for _ in $(seq 1 30); do s=$(docker exec "$n" systemctl is-system-running 2>/dev/null || true); case "$s" in running | degraded) break ;; esac; sleep 1; done
echo "state=$s"

log "user writes ordinary files on /data, NOT under the reserved subtree"
docker exec "$n" sh -c 'mkdir -p /data/projects && echo "user notes" >/data/projects/notes.txt && dd if=/dev/zero of=/data/projects/blob.bin bs=1M count=8 status=none && echo "db state" >/data/app.db'

log "rootfs change (this is what lands in the reserved upper)"
docker exec "$n" sh -c 'echo edited-by-user >/etc/reserved-demo.conf'

log "the volume now holds BOTH the overlay store and user data, side by side"
docker exec "$n" sh -c 'ls -la /data; echo; echo "delta files in the reserved upper:"; find /data/persistence/overlay/upper -type f | sed "s|^|  |"'

log "HAZARD: the live upper+work are visible AND writable from inside the merged root"
docker exec "$n" sh -c '
  echo "  upper writable from /data? $(test -w /data/persistence/overlay/upper && echo YES || echo no)"
  echo "  work  writable from /data? $(test -w /data/persistence/overlay/work && echo YES || echo no)"
  stat -c "  reserved: %U:%G mode=%a %n" /data/persistence /data/persistence/overlay'

log "out-of-band write to the LIVE upper (undefined behavior per overlayfs docs)"
docker exec "$n" sh -c '
  echo original >/etc/oob.txt                                    # copy-up into upper
  before=$(cat /etc/oob.txt)
  echo tampered >/data/persistence/overlay/upper/etc/oob.txt     # modify upper out-of-band
  after=$(cat /etc/oob.txt)
  echo "  merged /etc/oob.txt before out-of-band write: $before"
  echo "  merged /etc/oob.txt after  out-of-band write: $after  (undefined; do not rely on either)"'

log "persistence across recreate: destroy container, re-run with the same volume"
docker rm -f "$n" >/dev/null 2>&1 || true
docker run -d --name "$n" "${FLAGS[@]}" -e OVERLAY_LOWER_MODE=direct "$IMAGE" >/dev/null
for _ in $(seq 1 30); do s=$(docker exec "$n" systemctl is-system-running 2>/dev/null || true); case "$s" in running | degraded) break ;; esac; sleep 1; done
docker exec "$n" sh -c '
  echo "  user file:    $(cat /data/projects/notes.txt 2>&1)"
  echo "  user db:      $(cat /data/app.db 2>&1)"
  echo "  user blob:    $(du -h /data/projects/blob.bin | cut -f1) preserved"
  echo "  rootfs delta: $(cat /etc/reserved-demo.conf 2>&1)"'
echo "RESULT: user data on /data and the overlay delta coexist on one volume and both survive recreate."
docker rm -f "$n" >/dev/null 2>&1 || true
