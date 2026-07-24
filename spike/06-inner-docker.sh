#!/usr/bin/env bash
# Q6: does Docker-in-Docker still work when the container's root is OUR overlay?
#
# This is the question the whole engine hangs on for real users: Composery boxes
# run Docker inside them. Two configurations matter:
#   (a) dockerd's data-root left at /var/lib/docker  -> lands on our overlay upper
#   (b) dockerd's data-root pointed under /data      -> lands on the real ext4 volume
# For each we report the storage driver dockerd selects and whether a container
# actually runs.
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh

DIND_IMAGE="${PREFIX}:dind"
trap 'cleanup_containers' EXIT

log "build systemd+docker image"
build_image "$IMAGE" 1
# Derive from the spike image so the overlay entrypoint and systemd stay identical;
# add dockerd from Debian's own repo (no docker.com dependency).
docker build -q -t "$DIND_IMAGE" -f - . >/dev/null <<EOF
FROM ${IMAGE}
RUN apt-get update \
	&& DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
		docker.io docker-cli fuse-overlayfs ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
EOF

# $1 = case label, $2 = extra dockerd flags
run_case() {
	local label="$1" flags="$2"
	local name="${PREFIX}-dind-${label}"
	log "case ${label}: dockerd ${flags:-<default data-root>}"
	cleanup_containers
	fresh_volume

	mapfile -t flagv < <(prod_run_flags)
	docker run -d --name "$name" "${flagv[@]}" "$DIND_IMAGE" >/dev/null
	# Wait for systemd inside the pivoted overlay root to reach multi-user.
	for _ in $(seq 1 30); do
		docker exec "$name" systemctl is-system-running >/dev/null 2>&1 && break
		sleep 1
	done

	docker exec "$name" sh -c "
		set -e
		findmnt -no FSTYPE / | sed 's/^/  container root fstype: /'
		mkdir -p /etc/docker
		[ -n '${flags}' ] && printf '%s\n' '${flags}' >/etc/docker/daemon.json || true
		# restart, not start: docker.service is enabled by default, so it is
		# already running with the stock config by the time we write daemon.json.
		systemctl restart docker >/dev/null 2>&1 || true
		for _ in \$(seq 1 45); do docker info >/dev/null 2>&1 && break; sleep 1; done
		if docker info >/dev/null 2>&1; then
			docker info --format '  storage driver: {{.Driver}}'
			docker info --format '  data-root: {{.DockerRootDir}}'
			if docker run --rm hello-world >/dev/null 2>&1; then
				echo '  inner container ran: YES'
			else
				echo '  inner container ran: NO'
			fi
		else
			echo '  dockerd FAILED to start; last log:'
			journalctl -u docker --no-pager -n 12 --output=cat 2>&1 | sed 's/^/    /'
		fi
	" 2>&1 || echo "  case ${label}: exec failed"
}

run_case "default" ""
run_case "datavol" '{"data-root":"/data/docker"}'

log "done"
