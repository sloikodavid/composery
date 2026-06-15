#!/usr/bin/env bash
set -euo pipefail

/opt/persistd/bin/persistd apply

if [[ -f /etc/composery/composery.env ]]; then
  set -a
  # shellcheck disable=SC1091
  . /etc/composery/composery.env
  set +a
fi

case "${COMPOSERY_INIT:-supervisor}" in
  supervisor)
    exec /opt/composery/init/supervisor.sh
    ;;
  systemd)
    exec /opt/composery/init/systemd.sh
    ;;
  *)
    printf 'Unsupported COMPOSERY_INIT: %s\n' "${COMPOSERY_INIT}" >&2
    exit 64
    ;;
esac
