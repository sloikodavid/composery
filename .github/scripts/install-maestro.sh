#!/bin/sh
# Installs the exact Maestro release used by native E2E. The upstream installer
# is a mutable script, so executing it would leave the same pinned CLI version
# dependent on whatever installation logic happens to be served that day.
set -eu

: "${MAESTRO_VERSION:?MAESTRO_VERSION is required}"
: "${MAESTRO_SHA256:?MAESTRO_SHA256 is required}"

case "$MAESTRO_VERSION" in
  *[!0-9.]* | .* | *. | *..* | *.*.*.*)
    echo "MAESTRO_VERSION must be a numeric release version" >&2
    exit 1
    ;;
  *.*.*) ;;
  *)
    echo "MAESTRO_VERSION must be a numeric release version" >&2
    exit 1
    ;;
esac
case "$MAESTRO_SHA256" in
  *[!0-9a-f]* | "")
    echo "MAESTRO_SHA256 must be a lowercase SHA-256 digest" >&2
    exit 1
    ;;
esac
if [ "${#MAESTRO_SHA256}" -ne 64 ]; then
  echo "MAESTRO_SHA256 must be a lowercase SHA-256 digest" >&2
  exit 1
fi

install_dir="${MAESTRO_DIR:-$HOME/.maestro}"
case "$install_dir" in
  "" | / | "$HOME")
    echo "Refusing unsafe MAESTRO_DIR: $install_dir" >&2
    exit 1
    ;;
esac

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
