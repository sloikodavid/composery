#!/bin/sh
# Installs the exact Maestro release used by native E2E. The upstream installer
# is a mutable script, so executing it would leave the same pinned CLI version
# dependent on whatever installation logic happens to be served that day.
#
# The pin lives here, not in the workflows that call this: it was an env: block
# in both mobile-e2e.yml and mobile-release.yml, and renovate.json's custom
# manager only ever read the first, so a bump would have left the release
# workflow installing the old CLI against the new checksum. One home, one
# Renovate path. The validation those two inputs used to get is gone with them -
# a literal three lines above the code that reads it cannot arrive malformed,
# and a check that cannot fail only reports success forever.
set -eu

# renovate: datasource=github-releases depName=mobile-dev-inc/maestro
MAESTRO_VERSION=2.7.0
# GitHub release asset checksum. Renovate can bump the version above but its
# datasource does not expose asset hashes, so that PR intentionally stays red
# until this is copied from the release's checksums_sha256.txt.
MAESTRO_SHA256=a4ccab6b604617e7aef6db4f885666056eabe5cfa32befaa3bc994041b8fcbb5

install_dir="$HOME/.maestro"

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' 0 HUP INT TERM
archive="$scratch/maestro.zip"
url="https://github.com/mobile-dev-inc/Maestro/releases/download/cli-$MAESTRO_VERSION/maestro.zip"

curl -fsSL "$url" -o "$archive"
printf '%s  %s\n' "$MAESTRO_SHA256" "$archive" | shasum -a 256 -c -
unzip -q "$archive" -d "$scratch"
if [ ! -x "$scratch/maestro/bin/maestro" ]; then
  echo "Maestro archive has an unexpected layout" >&2
  exit 1
fi

mkdir -p "$install_dir"
rm -rf "${install_dir:?}/bin" "${install_dir:?}/lib"
cp -R "$scratch/maestro/bin" "$scratch/maestro/lib" "$install_dir/"
"$install_dir/bin/maestro" --version
