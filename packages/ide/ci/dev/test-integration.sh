#!/usr/bin/env bash
set -euo pipefail

help() {
  echo >&2 "  You can build the release with 'KEEP_MODULES=1 npm run release'"
  echo >&2 "  Or you can pass in a custom path."
  echo >&2 "  COMPOSERY_IDE_PATH='/var/tmp/coder/code-server/bin/code-server' npm run test:integration"
}

# Make sure a code-server release works. You can pass in the path otherwise it
# will look for $RELEASE_PATH in the current directory.
#
# This is to make sure we don't have Node version errors or any other
# compilation-related errors.
main() {
  cd "$(dirname "$0")/../.."

  source ./ci/lib.sh

  local path="$RELEASE_PATH/bin/code-server"
  if [[ ! ${COMPOSERY_IDE_PATH-} ]]; then
    echo "Set COMPOSERY_IDE_PATH to test another build of code-server"
  else
    path="$COMPOSERY_IDE_PATH"
  fi

  echo "Running tests with code-server binary: '$path'"

  if [[ ! -f $path ]]; then
    echo >&2 "No code-server build detected"
    echo >&2 "Looked in $path"
    help
    exit 1
  fi

  COMPOSERY_IDE_PATH="$path" ./node_modules/.bin/jest "$@" --coverage=false --testRegex "./tests/integration" --testPathIgnorePatterns "./tests/integration/fixtures"
}

main "$@"
