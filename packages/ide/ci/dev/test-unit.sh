#!/usr/bin/env bash
set -euo pipefail

main() {
  cd "$(dirname "$0")/../.."

  source ./ci/lib.sh

  # We must run jest from the root otherwise coverage will not include our
  # source files.
  ./node_modules/.bin/jest "$@" --testRegex "./test/unit/.*ts"
}

main "$@"
