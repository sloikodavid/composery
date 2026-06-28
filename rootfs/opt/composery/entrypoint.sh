#!/usr/bin/env bash
set -euo pipefail

/opt/composery/bin/composery persistence apply

if [ ! -s /etc/machine-id ]; then
  tr -d '-' < /proc/sys/kernel/random/uuid > /etc/machine-id
fi

# /data is root-owned (persistence runs as root); carve out a user-owned api dir
# so the editor user can mint and read API keys.
install -d -m 0700 -o user -g user "${COMPOSERY_DOCKER_VOLUME_PATH:-/data}/api"

case "${COMPOSERY_INIT:-supervisor}" in
  supervisor)
    exec /opt/composery/init/supervisor.sh
    ;;
  systemd)
    # systemd (PID 1) starts services with a clean env, so bridge code-server's
    # settings through a file its unit reads (/run is tmpfs, never persisted).
    ( umask 077
      env | grep -E '^(PASSWORD|HASHED_PASSWORD|PORT|VSCODE_PROXY_URI|EXTENSIONS_GALLERY|LOG_LEVEL|GITHUB_TOKEN|BROWSER|EDITOR|VISUAL|GIT_EDITOR|KUBE_EDITOR|LANG|LC_ALL|PATH|XDG_RUNTIME_DIR|HTTPS?_PROXY|https?_proxy)=|^COMPOSERY_' > /run/composery.env ) || true
    exec /opt/composery/init/systemd.sh
    ;;
  *)
    printf 'Unsupported COMPOSERY_INIT: %s (expected "supervisor" or "systemd")\n' "${COMPOSERY_INIT:-}" >&2
    exit 64
    ;;
esac
