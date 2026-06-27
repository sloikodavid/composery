#!/usr/bin/env bash
set -euo pipefail

/opt/composery/bin/composery persistence apply

# A stable machine-id makes the instance behave like a real host (dbus and friends
# expect one). systemd would generate one, but supervisor mode would not, so do
# it for both. persistence persists /etc/machine-id, so it stays stable on restart.
if [ ! -s /etc/machine-id ]; then
  tr -d '-' < /proc/sys/kernel/random/uuid > /etc/machine-id
fi

# The API key store lives on the persistent volume but is owned by the editor
# user, who both mints keys (`composery api key ...` in a terminal) and reads
# them (the API runs inside code-server as that user). persistence runs as root,
# so /data is root-owned; carve out a user-owned dir here, after apply and before
# the editor starts. Idempotent, and runs for both init modes.
install -d -m 0700 -o user -g user "${COMPOSERY_DOCKER_VOLUME_PATH:-/data}/api"

# The init is chosen by COMPOSERY_INIT; default to supervisor.
case "${COMPOSERY_INIT:-supervisor}" in
  supervisor)
    # supervisord and code-server inherit this process's environment directly.
    exec /opt/composery/init/supervisor.sh
    ;;
  systemd)
    # systemd (PID 1) does not pass its own environment to the services it starts,
    # so bridge the code-server settings through a file its unit reads. /run is
    # tmpfs and excluded from persistence, so nothing written here reaches /data.
    ( umask 077
      env | grep -E '^(PASSWORD|HASHED_PASSWORD|PORT|VSCODE_PROXY_URI|EXTENSIONS_GALLERY|LOG_LEVEL|GITHUB_TOKEN|BROWSER|EDITOR|VISUAL|GIT_EDITOR|KUBE_EDITOR|LANG|LC_ALL|PATH|XDG_RUNTIME_DIR|HTTPS?_PROXY|https?_proxy)=|^COMPOSERY_' > /run/composery.env ) || true
    exec /opt/composery/init/systemd.sh
    ;;
  *)
    printf 'Unsupported COMPOSERY_INIT: %s (expected "supervisor" or "systemd")\n' "${COMPOSERY_INIT:-}" >&2
    exit 64
    ;;
esac
