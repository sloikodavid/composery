#!/usr/bin/env bash
# Shared config + helpers for the overlay-root feasibility spike.
# Sourced by every numbered experiment script. Kept deliberately tiny.
#
# Everything we create is prefixed "overlay-spike-" so cleanup only ever removes
# our own containers/volumes/images and never touches anything else on the host.
set -euo pipefail

PREFIX=overlay-spike
IMAGE="${PREFIX}:v1"          # base image (LOWER_VERSION=1)
IMAGE_V2="${PREFIX}:v2"       # upgrade test: changed lower, same upper
VOLUME="${PREFIX}-data"

# Isolate the docker client config. Some hosts (Docker Desktop + WSL here) inject
# a credential helper that only exists on the host OS and breaks anonymous pulls
# of public images. A throwaway empty config dir sidesteps it without touching the
# operator's real ~/.docker. Harmless on a normal Linux host.
if [ -z "${DOCKER_CONFIG:-}" ]; then
	DOCKER_CONFIG="$(mktemp -d)"
	printf '{}\n' >"$DOCKER_CONFIG/config.json"
	export DOCKER_CONFIG
fi

log() { printf '\n=== %s ===\n' "$*"; }

# Mirror the production runtime flags from renderCompose() in
# packages/web/convex/boxes/infra/runtimeArtifacts.ts:
#   privileged: true, cgroup: host, stop_signal: SIGRTMIN+3,
#   tmpfs /run /run/lock /tmp, /sys/fs/cgroup:/sys/fs/cgroup:rw, <volume>:/data
# Emitted one token per line so `mapfile` turns it into a clean argv array.
prod_run_flags() {
	printf '%s\n' \
		--privileged \
		--cgroupns=host \
		--stop-signal SIGRTMIN+3 \
		-v /sys/fs/cgroup:/sys/fs/cgroup:rw \
		--tmpfs /run \
		--tmpfs /run/lock \
		--tmpfs /tmp \
		-v "${VOLUME}:/data"
}

# Remove every container whose name starts with our prefix. Never uses -a on
# unrelated resources.
cleanup_containers() {
	docker ps -aq --filter "name=^${PREFIX}-" | xargs -r docker rm -f >/dev/null 2>&1 || true
}

fresh_volume() {
	# Retry the rm: a just-exited `docker run --rm` reader can hold the volume for
	# a moment, and a silent rm failure would leave stale data behind and produce
	# misleading results. Give up only once the volume is actually gone.
	local _
	for _ in $(seq 1 10); do
		docker volume rm "$VOLUME" >/dev/null 2>&1 && break
		docker volume inspect "$VOLUME" >/dev/null 2>&1 || break
		sleep 0.5
	done
	docker volume create "$VOLUME" >/dev/null
}

# Read a file from the named volume via a throwaway container, or print $2 if
# absent. Used to inspect upper/whiteouts/markers after a container is removed.
volume_cat() {
	docker run --rm -v "${VOLUME}:/data" --entrypoint sh debian:trixie-slim \
		-c "cat '$1' 2>/dev/null || echo '${2:-ABSENT}'"
}

# Build the base image (LOWER_VERSION selects the lower content marker).
build_image() {
	local tag="$1" ver="$2"
	docker build -q --build-arg "LOWER_VERSION=${ver}" -t "$tag" "$(dirname "${BASH_SOURCE[0]}")" >/dev/null
}
