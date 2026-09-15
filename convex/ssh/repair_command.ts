import type { SshBootstrapFile } from "./cloud_init";

/**
 * The command a person runs on their own server to make Composery's access work again.
 * It is tied to what a stock Linux server with OpenSSH provides: root's default key file,
 * `sshd -T` for the port that the daemon's configuration sets, the default Ed25519 host key
 * path, and curl. On a machine where any of those differ, the part that does not apply fails
 * and the person sees which one, instead of Composery guessing on their behalf.
 */
export function toSshRepairCommand(
	bootstrapFile: SshBootstrapFile,
	publicKey: string,
) {
	return `set -eu
umask 077
mkdir -p /root/.ssh
key='${publicKey}'
grep -qxF "$key" /root/.ssh/authorized_keys 2>/dev/null || printf '%s\\n' "$key" >> /root/.ssh/authorized_keys
chmod 700 /root/.ssh
chmod 600 /root/.ssh/authorized_keys
port=$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}')
host_key=$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)
curl -fsS -X POST -H 'Content-Type: application/json' \\
  -d "{\\"allocationId\\":\\"${bootstrapFile.allocationId}\\",\\"token\\":\\"${bootstrapFile.token}\\",\\"hostKey\\":\\"$host_key\\",\\"port\\":\${port:-22}}" \\
  ${bootstrapFile.url}`;
}
