import type { SshBootstrapFile } from "./bootstrap_state";
import { reportHostKeyScript } from "./report_host_key_script";

const bootstrapFilePath = "/run/composery-bootstrap.json";

/** Returns cloud-config user data that installs the management key and reports the server's host key. */
export function renderCloudInit({
	publicKey,
	bootstrapFile,
	hostname,
}: {
	publicKey: string;
	bootstrapFile: SshBootstrapFile;
	hostname: string;
}) {
	// biome-ignore-start lint/style/useNamingConvention: cloud-init requires snake_case keys
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
		runcmd: [["/usr/bin/python3", "-I", "-c", reportHostKeyScript]],
	};
	// biome-ignore-end lint/style/useNamingConvention: cloud-init requires snake_case keys
	// JSON is a subset of YAML, so no value can become cloud-config structure.
	return `#cloud-config\n${JSON.stringify(config)}\n`;
}
