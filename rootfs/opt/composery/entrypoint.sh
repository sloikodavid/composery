#!/usr/bin/env bash
set -euo pipefail

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

case "${COMPOSERY_INIT:-supervisor}" in
  supervisor)
    exec /opt/composery/init/supervisor.sh
    ;;
  systemd)
    # systemd (PID 1) starts services with a clean env, so bridge the IDE's
    # settings through a file its unit reads (/run is tmpfs, never persisted).
    ( umask 077
      env | grep -E '^(PORT|HASHED_PASSWORD|BROWSER|EDITOR|VISUAL|GIT_EDITOR|KUBE_EDITOR|LANG|LC_ALL|PATH|XDG_RUNTIME_DIR|HTTPS?_PROXY|https?_proxy)=|^COMPOSERY_' > /run/composery.env ) || true
    exec /opt/composery/init/systemd.sh
    ;;
  *)
    printf 'Unsupported COMPOSERY_INIT: %s (expected "supervisor" or "systemd")\n' "${COMPOSERY_INIT:-}" >&2
    exit 64
    ;;
esac
