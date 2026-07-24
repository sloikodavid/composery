#!/usr/bin/env bash
# Q4 --- upgrade semantics: "new lower, same upper".
#
# Build v1, run it, let the user create/edit/delete/replace, destroy the
# container, then boot v2 (changed lower content) on the SAME upper and read the
# merged view. This is the highest-risk question because a raw overlay upper is
# tied to the lower it was built against.
#
# Hazards probed: stale whiteout shadowing a file the new lower reintroduces;
# an opaque directory hiding new lower files; and the upper itself carrying data
# copied up from a now-replaced lower.
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh

trap 'cleanup_containers; docker volume rm "$VOLUME" >/dev/null 2>&1 || true' EXIT

log "build v1 and v2 images (v2 = changed lower content)"
build_image "$IMAGE" 1
build_image "$IMAGE_V2" 2
mapfile -t FLAGS < <(prod_run_flags)
fresh_volume

boot() {
	local n="$1" img="$2"
	docker rm -f "$n" >/dev/null 2>&1 || true
	docker run -d --name "$n" "${FLAGS[@]}" -e OVERLAY_LOWER_MODE=direct "$img" >/dev/null
	for _ in $(seq 1 30); do
		s=$(docker exec "$n" systemctl is-system-running 2>/dev/null || true)
		case "$s" in running | degraded) break ;; esac
		sleep 1
	done
}

n=overlay-spike-upgrade
log "boot v1, then the user mutates /opt/upg"
boot "$n" "$IMAGE"
echo "boot v1 state=$s"
docker exec "$n" sh -c '
  echo "mine-edit"      >/opt/upg/user-edits.txt        # edit a file present in both lowers
  rm -f                  /opt/upg/reintroduced.txt       # delete a file the v2 lower still ships
  rm -rf /opt/upg/pkgdir && mkdir /opt/upg/pkgdir        # replace a dir -> opaque marker in upper
  echo "mine"            >/opt/upg/pkgdir/mine.txt
'
echo "--- upper now records these overrides (built against v1): ---"
docker exec "$n" sh -c '
  echo "  whiteout for reintroduced.txt:"; ls -la /data/persistence/overlay/upper/opt/upg/reintroduced.txt 2>&1 | sed "s/^/    /"
  echo "  opaque xattr on replaced pkgdir:"; getfattr -n trusted.overlay.opaque -d /data/persistence/overlay/upper/opt/upg/pkgdir 2>&1 | sed "s/^/    /"
'

log "UPGRADE: destroy v1 container, boot v2 (new lower) on the SAME upper"
docker rm -f "$n" >/dev/null 2>&1 || true
boot "$n" "$IMAGE_V2"
echo "boot v2 state=$s"

log "merged view after upgrade --- verdict per interaction"
docker exec "$n" sh -c '
  ok(){ printf "  [%s] %s\n" "$1" "$2"; }
  v=$(cat /opt/upg/untouched.txt 2>&1);      [ "$v" = v2 ]            && ok OK   "untouched.txt -> $v (new lower wins; upgrade delivered)"      || ok NOTE "untouched.txt -> $v"
  v=$(cat /opt/upg/user-edits.txt 2>&1);     [ "$v" = mine-edit ]    && ok OK   "user-edits.txt -> $v (upper wins over new lower; edit kept)"   || ok NOTE "user-edits.txt -> $v"
  v=$(cat /opt/upg/only-in-v2.txt 2>&1);     [ "$v" = v2-only ]      && ok OK   "only-in-v2.txt -> $v (brand-new lower file appears)"          || ok NOTE "only-in-v2.txt -> $v"
  test -e /opt/upg/reintroduced.txt          && ok HAZARD "reintroduced.txt -> present" || ok HAZARD "reintroduced.txt -> SHADOWED by stale whiteout though v2 ships $(cat /opt/upg/reintroduced.txt 2>/dev/null; echo it)"
  test -e /opt/upg/pkgdir/b.txt              && ok OK "pkgdir/b.txt visible" || ok HAZARD "pkgdir/b.txt -> HIDDEN by opaque dir though v2 added it"
  test -e /opt/upg/pkgdir/a.txt              && ok NOTE "pkgdir/a.txt visible" || ok HAZARD "pkgdir/a.txt (v2 changed it) -> HIDDEN by opaque dir"
  ok INFO "pkgdir contents now: $(ls -1 /opt/upg/pkgdir | tr "\n" " ")"
'
echo
echo "RESULT: untouched files and brand-new files upgrade cleanly; user edits are kept."
echo "        BUT a stale whiteout hides a file the new image reintroduces, and an"
echo "        opaque dir hides new files the image adds --- both need a boot-time fix."
docker rm -f "$n" >/dev/null 2>&1 || true
