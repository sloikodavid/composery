#!/usr/bin/env bash
set -euo pipefail

workspace="${HOME:-/home/user}/Desktop"
mkdir -p "$workspace"

exec /usr/local/bin/ide \
  --bind-addr "0.0.0.0:${PORT:-8080}" \
  --disable-update-check \
  "$workspace"
