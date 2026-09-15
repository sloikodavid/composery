import type { SshBootstrapFile } from "./cloud_init";

/**
 * The command a person runs on their own server when Composery can no longer sign in.
 * It asks the server where its own key file, host key and port are, through the SSH server's
 * own effective configuration, so a moved file or a changed port needs no new version of this
 * command. It asks with `-G` first, because `-T` also runs sanity checks that fail for reasons
 * that have nothing to do with the configuration, such as a missing privilege separation
 * directory. What it cannot ask for is the shell, `awk`, and either `curl` or Python 3; a
 * server without those reports which line failed instead of leaving a half-finished state.
 */
export function toSshBootstrapCommand(
	bootstrapFile: SshBootstrapFile,
	publicKey: string,
) {
	const body = `{\\"allocationId\\":\\"${bootstrapFile.allocationId}\\",\\"token\\":\\"${bootstrapFile.token}\\",\\"hostKey\\":\\"$host_key\\",\\"port\\":\${port:-22}}`;
	return `set -eu
umask 077
sshd_path=$(command -v sshd || echo /usr/sbin/sshd)
config=$("$sshd_path" -G 2>/dev/null || "$sshd_path" -T)
key_file=$(printf '%s\\n' "$config" | awk '/^authorizedkeysfile /{print $2; exit}')
case $key_file in /*) ;; *) key_file="$HOME/$key_file";; esac
key_file=$(printf '%s' "$key_file" | sed "s|%h|$HOME|g; s|%u|$(id -un)|g; s|%%|%|g")
mkdir -p "$(dirname "$key_file")"
key='${publicKey}'
grep -qxF "$key" "$key_file" 2>/dev/null || printf '%s\\n' "$key" >> "$key_file"
chmod 700 "$(dirname "$key_file")"
chmod 600 "$key_file"
host_key=$(cut -d' ' -f1,2 "$(printf '%s\\n' "$config" | awk '/^hostkey .*ed25519/{print $2; exit}').pub")
port=$(printf '%s\\n' "$config" | awk '/^port /{print $2; exit}')
body="${body}"
if command -v curl >/dev/null; then
  curl -fsS -X POST -H 'Content-Type: application/json' -d "$body" ${bootstrapFile.url}
else
  python3 -c 'import sys, urllib.request; urllib.request.urlopen(urllib.request.Request(sys.argv[1], data=sys.argv[2].encode(), headers={"Content-Type": "application/json"}), timeout=10)' ${bootstrapFile.url} "$body"
fi`;
}
