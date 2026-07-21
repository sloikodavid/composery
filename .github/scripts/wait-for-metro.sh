#!/bin/sh
# Blocks until the Expo dev server answers, then exits. Shared by the Android
# and iOS jobs in mobile-e2e.yml so both wait the same way.
#
# Deliberately not `timeout ... until ...`: macOS ships no timeout(1), so that
# form works on the Linux runner and fails on the macOS one - the exact class of
# break this workflow exists to catch.
set -eu

URL="${METRO_URL:-http://127.0.0.1:8081/status}"
ATTEMPTS="${METRO_ATTEMPTS:-60}"

i=0
while [ "$i" -lt "$ATTEMPTS" ]; do
	if curl -fsS "$URL" >/dev/null 2>&1; then
		echo "Metro is serving at $URL"
		exit 0
	fi
	i=$((i + 1))
	sleep 5
done

# Falling through must fail: a silent continue would hand Maestro an app stuck
# on a connection error and report the flow failure as a UI bug.
echo "Metro did not answer at $URL after $((ATTEMPTS * 5))s" >&2
exit 1
