#!/usr/bin/env bash
set -euo pipefail

# Restart the container once when a runtime that was serving stops serving. A
# boot that never became healthy is left alone: restarting the same bad
# configuration for ever would be a loop, while the external health sweep can
# report and repair it with a bounded attempt policy.
was_healthy=false
failures=0

while sleep 10; do
  if supervisorctl status persistence caddy ide cron 2>/dev/null |
      awk 'NF < 2 || $2 != "RUNNING" { bad = 1 } END { exit bad }' \
    && curl -fsS "http://127.0.0.1:${PORT:-8080}/_composery/healthz" >/dev/null 2>&1; then
    was_healthy=true
    failures=0
    continue
  fi

  if [ "$was_healthy" = false ]; then
    continue
  fi

  failures=$((failures + 1))
  if [ "$failures" -lt 3 ]; then
    continue
  fi

  printf 'A previously healthy runtime failed three checks; restarting the container.\n' >&2
  kill -TERM 1
  exit 1
done
