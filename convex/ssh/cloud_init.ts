import type { SshBootstrapFile } from "./bootstrap_state";
import { reportHostKeyScript } from "./scripts/report_host_key";

const bootstrapFilePath = "/run/composery-bootstrap.json";

/** Installs management access and reports the host key during bootstrap. */
export function renderCloudInit({
	publicKey,
	bootstrapFile,
	hostname,
}: {
	publicKey: string;
	bootstrapFile: SshBootstrapFile;
	hostname: string;
}) {
	// biome-ignore-start lint/style/useNamingConvention: external snake_case keys
	const config = {
		hostname,
		preserve_hostname: false,
		ssh_pwauth: false,
		disable_root: false,
		ssh_genkeytypes: ["ed25519", "rsa", "ecdsa"],
		chpasswd: { expire: false },
		users: [
			{
				name: "root",
				lock_passwd: true,
				ssh_authorized_keys: [publicKey],
			},
		],
		write_files: [
			{
				path: bootstrapFilePath,
				permissions: "0600",
				owner: "root:root",
				content: JSON.stringify(bootstrapFile),
			},
		],
		runcmd: [["python3", "-I", "-c", reportHostKeyScript]],
	};
	// biome-ignore-end lint/style/useNamingConvention: external snake_case keys
	return `#cloud-config\n${JSON.stringify(config)}\n`;
}
