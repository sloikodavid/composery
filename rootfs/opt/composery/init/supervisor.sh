#!/usr/bin/env bash
set -euo pipefail

# Give the user a real XDG_RUNTIME_DIR (gpg, dbus, podman, ... expect one). A
# normal login creates /run/user/<uid> via logind; there is none here, so make
# it ourselves. systemd mode does this from composery.service instead.
install -d -m 0755 /run/user
install -d -m 0700 -o user -g user /run/user/1000

exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
