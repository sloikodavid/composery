#!/usr/bin/env bash
set -euo pipefail

# Install VS Code's own dependencies.  VS Code remains the one npm island in the
# Composery IDE; everything else uses pnpm.
main() {
  cd "$(dirname "$0")/../.."

  if [[ ! -f lib/vscode/package.json ]]; then
    echo "lib/vscode/package.json is missing; did you run git submodule update --init?"
    exit 1
  fi

  pushd lib/vscode
  npm ci
  popd
}

main "$@"
