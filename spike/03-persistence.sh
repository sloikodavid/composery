#!/usr/bin/env bash
# Q3 --- persistence across `docker rm` + re-run on the same volume.
# Modify + delete + create rootfs files under /etc and /usr, destroy the
# container, boot again on the same volume, and confirm the merged view:
#   modified survive via upper, deletions survive via whiteouts, untouched
#   files still come from the (image) lower.
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh

trap 'cleanup_containers; docker volume rm "$VOLUME" >/dev/null 2>&1 || true' EXIT

log "build + boot (fresh volume)"
build_image "$IMAGE" 1
mapfile -t FLAGS < <(prod_run_flags)
fresh_volume

boot() {
	local n="$1"
	docker rm -f "$n" >/dev/null 2>&1 || true
	docker run -d --name "$n" "${FLAGS[@]}" -e OVERLAY_LOWER_MODE=direct "$IMAGE" >/dev/null
	for _ in $(seq 1 30); do
		s=$(docker exec "$n" systemctl is-system-running 2>/dev/null || true)
		case "$s" in running | degraded) break ;; esac
		sleep 1
	done
}

n=overlay-spike-persist
boot "$n"
echo "boot #1 state=$s"

log "mutate the rootfs (create / modify / delete under /etc and /usr)"
docker exec "$n" sh -c '
  echo "created" >/etc/created-by-user.conf                       # CREATE under /etc
  mkdir -p /usr/local/share/myapp && echo hi >/usr/local/share/myapp/data  # CREATE under /usr
  sed -i "s/^/MODIFIED /" /usr/share/overlay-spike-marker         # MODIFY an image file under /usr
  rm -f /etc/overlay-spike-lower                                  # DELETE an image file under /etc
'
echo "mutations applied"

log "whiteout representation on the volume (deleted /etc/overlay-spike-lower)"
docker exec "$n" sh -c 'ls -la /data/persistence/overlay/upper/etc/overlay-spike-lower; echo "  ^ char device 0:0 = overlayfs classic whiteout"'

log "destroy container, re-run on the SAME volume"
docker rm -f "$n" >/dev/null 2>&1 || true
boot "$n"
echo "boot #2 state=$s"

log "merged view after recreate"
docker exec "$n" sh -c '
  printf "  CREATE /etc/created-by-user.conf : %s\n" "$(cat /etc/created-by-user.conf 2>&1)"
  printf "  CREATE /usr/local/share/myapp    : %s\n" "$(cat /usr/local/share/myapp/data 2>&1)"
  printf "  MODIFY /usr/share/overlay-spike-marker : %s\n" "$(cat /usr/share/overlay-spike-marker 2>&1)"
  printf "  DELETE /etc/overlay-spike-lower  : %s\n" "$(test -e /etc/overlay-spike-lower && echo STILL-PRESENT || echo gone-via-whiteout)"
  printf "  UNTOUCHED /etc/os-release id     : %s\n" "$(. /etc/os-release; echo "$ID $VERSION_CODENAME (from image lower)")"
'
echo "RESULT: creates+modifies persist via upper; delete persists via whiteout; untouched files come from the image lower."
docker rm -f "$n" >/dev/null 2>&1 || true
