#!/usr/bin/env bash
set -euo pipefail

# Caddy owns the public port and reverse-proxies the IDE on the loopback one.
# Equal values leave the two fighting over one bind in a restart loop.
if [ "${PORT:-8080}" = "${COMPOSERY_IDE_PORT:-8081}" ]; then
  printf 'PORT and COMPOSERY_IDE_PORT are both %s; they must differ.\n' "${PORT:-8080}" >&2
  exit 78
fi

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
