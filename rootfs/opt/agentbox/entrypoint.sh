#!/usr/bin/env bash
set -euo pipefail

node /opt/agentbox/runtime.ts --prepare-runtime-dirs
/opt/agentbox/bin/persistd restore
node /opt/agentbox/runtime.ts --prepare-workspace
exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
