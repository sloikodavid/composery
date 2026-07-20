#!/usr/bin/env bash
set -euo pipefail

# Removes the registered IDE password so the next visit lands on the register
# page again. This runs on every boot while the variable is set, which leaves
# the instance open for anyone to claim, so the warning below tells the operator
# to turn it off. Only 1/true enable it (trimmed and case-insensitive, like the
# API's bool()), so 0, false, and any typo leave the password alone: the wrong
# value must fail towards keeping the instance protected.
removal="${COMPOSERY_REMOVE_PASSWORD:-}"
removal="${removal//[[:space:]]/}"
case "${removal,,}" in
  1 | true) ;;
  *) exit 0 ;;
esac

# HOME is root's here, so the IDE's own config location is spelled out. Keep it
# in step with paths.config in patches/naming.diff.
config_path="${COMPOSERY_CONFIG:-/home/user/.config/composery/config.yaml}"
if [ -f "$config_path" ]; then
  # The config is a flat js-yaml dump, so each password key is one line.
  # ponytail: line-oriented, not a YAML parse - a folded scalar would survive.
  sed -i -e '/^password:/d' -e '/^hashed-password:/d' "$config_path"
  # sed -i renames a fresh file into place, which would leave this root-owned
  # and stop the IDE (running as user) writing the next registered password.
  chown user:user "$config_path"
fi

if [ -n "${COMPOSERY_PASSWORD:-}" ] || [ -n "${COMPOSERY_HASHED_PASSWORD:-}" ]; then
  echo "COMPOSERY_REMOVE_PASSWORD is set, but COMPOSERY_PASSWORD/COMPOSERY_HASHED_PASSWORD takes precedence and still governs sign-in." >&2
  exit 0
fi

# The variable does the same thing on a cloud box - owners control their own
# host, so they can set it - but the consequence differs: with no password
# configured, /register diverts a cloud box into the dashboard ownership check
# instead of offering the open create-password screen. Report what is true here
# rather than warning about an exposure this deployment does not have.
if [ -n "${COMPOSERY_CLOUD_BOX_ID:-}" ]; then
  echo "WARNING: COMPOSERY_REMOVE_PASSWORD is set, so this box has no password. Setting a new one still has to pass the Composery ownership check, so the box is not open to whoever finds it, but the password is removed again on every restart until you set COMPOSERY_REMOVE_PASSWORD=0 (or unset it)." >&2
  exit 0
fi

echo "WARNING: COMPOSERY_REMOVE_PASSWORD is set, so this instance has NO PASSWORD and anyone who reaches it can register one and take it over. Register your new password now, then set COMPOSERY_REMOVE_PASSWORD=0 (or unset it) and restart - until you do, every restart removes the password again." >&2
