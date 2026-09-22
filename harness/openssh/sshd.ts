import { randomBytes } from "node:crypto";
import type { SshConnectionOptions } from "../../convex/ssh/connection";
import { withSshConnection } from "../../convex/ssh/connection";
import { generateSshKeyPair } from "../../convex/ssh/key_pair";
import { readSshFile } from "../../convex/ssh/read_file";
import { quoteShell } from "../../convex/ssh/scripts/shell";
import {
	removeOrphanedDockerContainers,
	requireDocker,
	runDocker,
	toDockerOwnerLabels,
} from "../docker";
import { ubuntuArchiveSnapshot, ubuntuImage } from "../pins";

/** The log is the evidence of what the test server accepted. */
export const sshdLogPath = "/var/log/sshd.log";
const image = "composery-test-sshd";
const kind = "sshd";
const startCommand = `/usr/sbin/sshd -E ${sshdLogPath}`;
const dockerfile = `FROM ${ubuntuImage}
RUN apt-get update \\
 && apt-get install -y --no-install-recommends ca-certificates \\
 && sed -i -E 's#URIs: http://(archive|security).ubuntu.com/ubuntu/?#URIs: https://snapshot.ubuntu.com/ubuntu/${ubuntuArchiveSnapshot}/#' /etc/apt/sources.list.d/ubuntu.sources \\
 && ! grep -qE 'URIs: http://(archive|security)' /etc/apt/sources.list.d/ubuntu.sources \\
 && apt-get update \\
 && apt-get install -y --no-install-recommends openssh-server python3 \\
 && rm -rf /var/lib/apt/lists/*
RUN ssh-keygen -A && mkdir -p /run/sshd /root/.ssh && chmod 700 /root/.ssh
CMD ["sh", "-c", "${startCommand} && exec sleep infinity"]
`;
const sshPort = 22;
const rootKeyPath = "/root/.ssh/authorized_keys";
const settingPath = "/etc/ssh/sshd_config.d/00-test.conf";
const connectionTimeoutMs = 5000;
const readinessAttempts = 60;
const readinessDelayMs = 250;
const readLimitBytes = 4096;
const accountSuffixBytes = 3;
// Stop the old daemon before restart; reload can race a new connection.
const restartScript = `sshd -t && pid="$(cat /run/sshd.pid)" && kill "$pid" && while kill -0 "$pid" 2>/dev/null; do sleep 0.05; done && ${startCommand}`;

export type SshdAccount = Readonly<{
	name: string;
	home: string;
	keyPath: string;
}>;

export type SshdServer = Readonly<{
	stop: () => Promise<void>;
	connection: SshConnectionOptions;
	run: (script: string) => string;
	createAccount: () => SshdAccount;
	withSettingOnDisk: <T>(
		setting: string,
		check: () => Promise<T>,
	) => Promise<T>;
	withSettingApplied: <T>(
		setting: string,
		check: () => Promise<T>,
	) => Promise<T>;
}>;

async function waitUntilReachable(options: SshConnectionOptions) {
	let lastError: unknown;
	for (let attempt = 0; attempt < readinessAttempts; attempt += 1) {
		try {
			await withSshConnection(
				options,
				async (connection) =>
					await readSshFile(connection, {
						path: rootKeyPath,
						maxBytes: readLimitBytes,
					}),
			);
			return;
		} catch (error) {
			lastError = error;
			await Bun.sleep(readinessDelayMs);
		}
	}
	throw new Error(
		`The container's SSH server never accepted Composery: ${String(lastError)}`,
	);
}

export async function startSshd(): Promise<SshdServer> {
	await using resources = new AsyncDisposableStack();
	requireDocker();
	removeOrphanedDockerContainers(kind);
	runDocker(
		["build", "--quiet", "--tag", image, "--file", "-", "."],
		dockerfile,
	);
	const container = runDocker([
		"run",
		"--detach",
		"--init",
		...toDockerOwnerLabels(kind),
		"--publish",
		`127.0.0.1::${sshPort}`,
		image,
	]);
	resources.defer(() => {
		runDocker(["rm", "--force", container]);
	});
	const run = (script: string) =>
		runDocker(["exec", container, "sh", "-c", script]);

	const managementKey = generateSshKeyPair();
	run(
		`printf '%s\\n' ${quoteShell(`${managementKey.publicKey} composery-test`)} > ${rootKeyPath} && chmod 600 ${rootKeyPath}`,
	);
	const hostKey = run("cat /etc/ssh/ssh_host_ed25519_key.pub").split(" ")[1];
	const mapped = runDocker(["port", container, String(sshPort)]);
	const connection: SshConnectionOptions = {
		address: "127.0.0.1",
		port: Number(mapped.split("\n")[0]?.split(":").at(-1)),
		username: "root",
		privateKey: managementKey.privateKey,
		hostKey: Buffer.from(hostKey ?? "", "base64"),
		timeoutMs: connectionTimeoutMs,
	};
	await waitUntilReachable(connection);

	const restart = async () => {
		run(restartScript);
		await waitUntilReachable(connection);
	};
	const writeSetting = (setting: string) =>
		run(`printf '%s\\n' ${quoteShell(setting)} > ${settingPath}`);
	const removeSetting = () => run(`rm -f ${settingPath}`);

	const owned = resources.move();
	return {
		stop: () => owned.disposeAsync(),
		connection,
		run,
		createAccount: () => {
			const name = `test${randomBytes(accountSuffixBytes).toString("hex")}`;
			const home = `/home/${name}`;
			const keyPath = `${home}/.ssh/authorized_keys`;
			run(
				[
					`useradd --create-home --shell /bin/bash ${name}`,
					`usermod --password '*' ${name}`,
					`install -d -m 700 -o ${name} -g ${name} ${home}/.ssh`,
					`install -m 600 -o ${name} -g ${name} /dev/null ${keyPath}`,
				].join(" && "),
			);
			return { name, home, keyPath };
		},
		withSettingOnDisk: async (setting, check) => {
			writeSetting(setting);
			try {
				return await check();
			} finally {
				removeSetting();
			}
		},
		withSettingApplied: async (setting, check) => {
			writeSetting(setting);
			try {
				await restart();
				return await check();
			} finally {
				removeSetting();
				await restart();
			}
		},
	};
}
