#!/usr/bin/env bash
# Q1 --- overlay mount + pivot_root + systemd boot in a privileged container.
#
# Also settles the nested-lowerdir angle: the lower is the container's own Docker
# overlay "/", so a successful boot proves overlay-on-overlay works on this host.
# Runs both lower shapes: 'direct' (lowerdir=/) and 'bind' (ro bind of / first).
#
# Standalone + self-cleaning. Prints trimmed evidence for FINDINGS.md.
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh

trap 'cleanup_containers; docker volume rm "$VOLUME" >/dev/null 2>&1 || true' EXIT

log "build base image (LOWER_VERSION=1)"
build_image "$IMAGE" 1
echo "built $IMAGE"

log "nested-overlay baseline: fstype of a plain container root (the future lower)"
mapfile -t FLAGS < <(prod_run_flags)
docker run --rm --entrypoint findmnt "$IMAGE" -no FSTYPE / \
	|| echo "(could not read root fstype)"

run_boot() {
	local mode="$1" name="${PREFIX}-boot-${1}"
	docker rm -f "$name" >/dev/null 2>&1 || true
	fresh_volume

	log "boot: OVERLAY_LOWER_MODE=$mode (fresh volume)"
	if ! docker run -d --name "$name" "${FLAGS[@]}" \
		-e OVERLAY_LOWER_MODE="$mode" "$IMAGE" >/dev/null; then
		echo "RESULT[$mode]: docker run failed to start"
		return 1
	fi

	# Wait for systemd to settle (degraded is normal in a container).
	local state=""
	for _ in $(seq 1 30); do
		state="$(docker exec "$name" systemctl is-system-running 2>/dev/null || true)"
		case "$state" in running | degraded) break ;; esac
		sleep 1
	done

	if [ -z "$state" ]; then
		echo "RESULT[$mode]: systemd never answered --- boot logs:"
		docker logs "$name" 2>&1 | tail -n 25
		docker rm -f "$name" >/dev/null 2>&1 || true
		return 1
	fi

	echo "system state: $state (degraded = a few host-only units can't run in a container; listed below)"
	docker exec "$name" systemctl --failed --no-legend --plain 2>/dev/null | sed 's/^/failed-unit: /' || true
	echo "--- root is the overlay we built (upper on the volume): ---"
	docker exec "$name" findmnt -no SOURCE,FSTYPE /
	echo "--- journald + sample unit active: ---"
	printf 'systemd-journald: %s\n' "$(docker exec "$name" systemctl is-active systemd-journald || true)"
	printf 'overlay-spike-sample: %s\n' "$(docker exec "$name" systemctl is-active overlay-spike-sample || true)"
	docker exec "$name" cat /run/overlay-spike-sample.marker 2>/dev/null | sed 's/^/start-marker: /'
	echo "--- /data volume + reserved upper present in merged tree: ---"
	docker exec "$name" findmnt -no SOURCE,TARGET,FSTYPE /data
	docker exec "$name" ls -la /data/persistence/overlay

	echo "--- clean shutdown via SIGRTMIN+3 (docker stop): ---"
	local t0 t1 code
	t0="$(date +%s)"
	docker stop -t 15 "$name" >/dev/null
	t1="$(date +%s)"
	code="$(docker inspect -f '{{.State.ExitCode}}' "$name")"
	docker rm -f "$name" >/dev/null 2>&1 || true
	# ExecStop writes this to the volume ONLY on an orderly unit stop, so its
	# presence proves systemd ran shutdown (not that PID 1 was killed). SIGKILL
	# would leave it absent; see the exit-code contrast in FINDINGS.
	local shutdown_marker
	shutdown_marker="$(volume_cat /data/overlay-spike-shutdown.log ABSENT)"
	echo "orderly-shutdown marker: $shutdown_marker"
	echo "RESULT[$mode]: booted; stop took $((t1 - t0))s; exit code $code (130 = systemd container poweroff); orderly=$([ "$shutdown_marker" = clean-stop ] && echo yes || echo no)"
}

run_boot direct || echo "DIRECT MODE FAILED (evidence above)"
run_boot bind || echo "BIND MODE FAILED (evidence above)"

log "done"
