#!/usr/bin/env bash
set -euo pipefail

# Caddy owns the public port and reverse-proxies the IDE on the loopback one.
# Equal values leave the two fighting over one bind in a restart loop.
if [ "${PORT:-8080}" = "${COMPOSERY_IDE_PORT:-8081}" ]; then
  printf 'PORT and COMPOSERY_IDE_PORT are both %s; they must differ.\n' "${PORT:-8080}" >&2
  exit 78
fi

# Pick the persistence engine. Mirrors COMPOSERY_INIT exactly: auto (default),
# overlay, or copy; an unsupported value is a clear message + exit 64. See
# docs/persistence.md and docs/configuration.md.
case "${COMPOSERY_PERSISTENCE:-auto}" in
  auto | overlay | copy) ;;
  *)
    printf 'Unsupported COMPOSERY_PERSISTENCE: %s (expected "auto", "overlay", or "copy")\n' "${COMPOSERY_PERSISTENCE:-}" >&2
    exit 64
    ;;
esac

# select-engine probes by *doing* (a real overlay mount on the /data volume for
# auto), records the choice and reason where `persistence status` reports them,
# and prints the engine. It exits non-zero - failing boot loudly, never a silent
# fallback - when an explicit overlay pin cannot be honoured.
engine="$(/opt/composery/bin/composery persistence select-engine)"

if [ "$engine" = overlay ]; then
  # SCAFFOLD - the overlay engine is not finished, and select-engine only ever
  # prints "overlay" once persistence::engine::OVERLAY_ENGINE_READY is flipped
  # on, so this branch is unreachable in this build and fails loudly rather than
  # half-mounting. The finished engine must, per spike/FINDINGS.md, before it
  # hands off to the init system:
  #   1. reuse select-engine's probe result (already done);
  #   2. recreate work/ every boot (a hard-killed container leaves it dirty);
  #   3. `mount --make-rprivate /` before any move;
  #   4. rebind /proc /sys /dev /run /tmp, the /data volume, AND /etc/resolv.conf
  #      /etc/hosts /etc/hostname into the merged tree before pivot_root - without
  #      the resolver files there is NO DNS at all (Hazard D);
  #   5. run an upper-hygiene pass reconciling stale whiteouts and opaque dirs
  #      against the new lower, bounded by deletion count and reporting what it
  #      reconciles (Hazards B and C);
  #   6. keep the reserved upper subtree out of the persisted set, and bind
  #      /opt/composery and /opt/persistence so image code cannot become a delta.
  # Under overlay the copy daemon's watcher/audit/apply must not run - the kernel
  # owns the delta - and status must say so.
  printf 'The overlay persistence engine is not implemented in this build.\n' >&2
  exit 1
fi

# copy engine: replay the persisted delta over the image rootfs.
/opt/composery/bin/composery persistence apply

if [ ! -s /etc/machine-id ]; then
  tr -d '-' < /proc/sys/kernel/random/uuid > /etc/machine-id
fi

# The durable volume is a normal user-owned disk. Persistence keeps its own
# root-owned subdirectory, while applications can place large state directly
# on the volume without duplicating it into the rootfs delta store.
volume_root="${COMPOSERY_DOCKER_VOLUME_PATH:-/data}"
chown user:user "$volume_root"
chmod 0755 "$volume_root"
install -d -m 0700 -o user -g user "$volume_root/api"

# Sharing a device with / means nothing is mounted here, so persistence would
# write the delta into the container layer and lose it on the next recreate.
# Comparing devices rather than mountpoints keeps a subdirectory of a mount
# (a volume on /mnt with the root at /mnt/data) correct. A warning, not a
# failure: running with no volume at all is a legitimate way to try Composery.
if [ "$(stat -c %d "$volume_root")" = "$(stat -c %d /)" ]; then
  printf 'Warning: no volume is mounted at %s, so changes will be lost when this container is recreated. Mount a volume or disk there, or point COMPOSERY_DOCKER_VOLUME_PATH at one.\n' "$volume_root" >&2
fi

# After persistence apply, or the restored delta would put the password back.
/opt/composery/remove-password.sh

case "${COMPOSERY_INIT:-supervisor}" in
  supervisor)
    exec /opt/composery/init/supervisor.sh
    ;;
  systemd)
    # systemd (PID 1) starts services with a clean env, so bridge the IDE's
    # settings through a file its unit reads (/run is tmpfs, never persisted).
    ( umask 077
      env | grep -E '^(PORT|BROWSER|EDITOR|VISUAL|GIT_EDITOR|KUBE_EDITOR|LANG|LC_ALL|PATH|XDG_RUNTIME_DIR|HTTPS?_PROXY|https?_proxy)=|^COMPOSERY_' > /run/composery.env ) || true
    exec /opt/composery/init/systemd.sh
    ;;
  *)
    printf 'Unsupported COMPOSERY_INIT: %s (expected "supervisor" or "systemd")\n' "${COMPOSERY_INIT:-}" >&2
    exit 64
    ;;
esac
