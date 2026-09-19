import type { SshBootstrapFile } from "../bootstrap_state";

/** Uses sshd's effective configuration and updates only the managed key entries. */
export function renderSshBootstrapScript({
	bootstrapFile,
	publicKey,
	previousPublicKey,
}: {
	bootstrapFile: SshBootstrapFile;
	publicKey: string;
	previousPublicKey: string;
}) {
	const body = `{\\"allocationId\\":\\"${bootstrapFile.allocationId}\\",\\"token\\":\\"${bootstrapFile.token}\\",\\"hostKey\\":\\"$host_key\\",\\"port\\":\${port:-22}}`;
	return `set -eu
umask 077
sshd_path=$(command -v sshd || echo /usr/sbin/sshd)
config=$("$sshd_path" -G 2>/dev/null || "$sshd_path" -T)
key_file=$(printf '%s\n' "$config" | awk '/^authorizedkeysfile /{print $2; exit}')
case $key_file in /*) ;; *) key_file="$HOME/$key_file";; esac
key_file=$(printf '%s' "$key_file" | sed "s|%h|$HOME|g; s|%u|$(id -un)|g; s|%%|%|g")
mkdir -p "$(dirname "$key_file")"
key='${publicKey}'
old_key='${previousPublicKey.split(" ")[1] ?? ""}'
new_key='${publicKey.split(" ")[1] ?? ""}'
touch "$key_file"
kept=$(awk -v old="$old_key" -v mine="$new_key" '{ for (i = 1; i <= NF; i++) if ($i == old || $i == mine) next; print }' "$key_file")
if [ -n "$kept" ]; then printf '%s\n' "$kept" > "$key_file"; else : > "$key_file"; fi
printf '%s\n' "$key" >> "$key_file"
chmod 700 "$(dirname "$key_file")"
chmod 600 "$key_file"
host_key=$(cut -d' ' -f1,2 "$(printf '%s\n' "$config" | awk '/^hostkey .*ed25519/{print $2; exit}').pub")
port=$(printf '%s\n' "$config" | awk '/^port /{print $2; exit}')
body="${body}"
if command -v curl >/dev/null; then
  curl -fsS -X POST -H 'Content-Type: application/json' -d "$body" ${bootstrapFile.url}
else
  python3 -c 'import sys, urllib.request; urllib.request.urlopen(urllib.request.Request(sys.argv[1], data=sys.argv[2].encode(), headers={"Content-Type": "application/json"}), timeout=10)' ${bootstrapFile.url} "$body"
fi`;
}
