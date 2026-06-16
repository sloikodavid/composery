#!/usr/bin/env bash
set -euo pipefail

/opt/persistd/bin/persistd apply

# The init is chosen by the container command; default to supervisor.
case "${1:-supervisor}" in
  supervisor)
    # supervisord and code-server inherit this process's environment directly.
    exec /opt/composery/init/supervisor.sh
    ;;
  systemd)
    # systemd (PID 1) does not pass its own environment to the services it starts,
    # so bridge the code-server settings through a file its unit reads. /run is
    # tmpfs and excluded from persistd, so nothing written here reaches /data.
    ( umask 077
      env | grep -E '^(PASSWORD|HASHED_PASSWORD|PORT|VSCODE_PROXY_URI|EXTENSIONS_GALLERY|LOG_LEVEL|GITHUB_TOKEN|HTTPS?_PROXY|https?_proxy)=|^COMPOSERY_' > /run/composery.env ) || true
    exec /opt/composery/init/systemd.sh
    ;;
  *)
    printf 'Unsupported init: %s (expected "supervisor" or "systemd")\n' "${1}" >&2
    exit 64
    ;;
esac
