/// <reference types="bun" />

import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import ssh2 from "ssh2";
import { AuthorizedKeysFile } from "./authorized_keys";
import { type SshConnectionOptions, SshError } from "./connection";
import { discoverSshServer } from "./discovery";
import { setSshHostname } from "./hostname";
import { inspectSshPublicKey } from "./inspect_public_key";
import { readSshFile } from "./read_file";
import { removeAuthorizedKeys } from "./remove_authorized_keys";
import { writeSshFile } from "./write_file";

/**
 * Runs the real remote operations against a real OpenSSH server in a container, because the
 * guarantees they claim - preserved bytes, preserved metadata, a refused write after a change -
 * exist only in the interaction with sshd, not in our own code. Skipped where Docker is absent.
 */
const image = "composery-server-test";
const dockerfile = `FROM ubuntu:24.04
RUN apt-get update \\
 && apt-get install -y --no-install-recommends openssh-server python3 \\
 && rm -rf /var/lib/apt/lists/*
RUN ssh-keygen -A && mkdir -p /run/sshd /root/.ssh && chmod 700 /root/.ssh
CMD ["/usr/sbin/sshd", "-D", "-e"]
`;
const keyPath = "/root/.ssh/authorized_keys";
const connectionTimeoutMs = 20_000;
const testTimeoutMs = 240_000;
const sshPort = 22;
const maxOutputBytes = 16_777_216;
const readLimitBytes = 65_536;
const startupAttempts = 30;
const startupWaitMs = 1000;
const keyFileMode = 0o600;
const permissionMask = 0o777;

function docker(args: string[], input?: string) {
	const result = spawnSync("docker", args, {
		encoding: "utf8",
		input,
		maxBuffer: maxOutputBytes,
	});
	if (result.status !== 0) {
		throw new Error(
			`docker ${args[0]} failed: ${result.stderr || result.stdout}`,
		);
	}
	return result.stdout.trim();
}

const hasDocker =
	spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
		encoding: "utf8",
	}).status === 0;

let container = "";
let connection: SshConnectionOptions;

async function readFile(path = keyPath) {
	return await readSshFile({ ...connection, path, maxBytes: readLimitBytes });
}

function exec(...command: string[]) {
	return docker(["exec", container, ...command]);
}

beforeAll(async () => {
	if (!hasDocker) {
		return;
	}
	docker(["build", "-q", "-t", image, "-f", "-", "."], dockerfile);
	container = docker(["run", "-d", "--rm", "-p", "127.0.0.1::22", image]);
	const keyPair = ssh2.utils.generateKeyPairSync("ed25519");
	exec(
		"sh",
		"-c",
		`printf '%s\\n' '${keyPair.public} test' > ${keyPath} && chmod 600 ${keyPath}`,
	);
	const hostKey = exec("cat", "/etc/ssh/ssh_host_ed25519_key.pub").split(
		" ",
	)[1];
	const mapped = docker(["port", container, String(sshPort)]);
	connection = {
		address: "127.0.0.1",
		port: Number(mapped.split(":").at(-1)),
		username: "root",
		privateKey: keyPair.private,
		hostKey: Buffer.from(hostKey ?? "", "base64"),
		timeoutMs: connectionTimeoutMs,
	};
	// sshd needs a moment before it accepts the first connection.
	for (let attempt = 0; attempt < startupAttempts; attempt++) {
		try {
			await readFile();
			return;
		} catch {
			await Bun.sleep(startupWaitMs);
		}
	}
	throw new Error("The container's SSH server did not become reachable.");
}, testTimeoutMs);

afterAll(() => {
	if (container) {
		docker(["rm", "-f", container]);
	}
});

test.skipIf(!hasDocker)(
	"reads a file with its metadata",
	async () => {
		const observation = await readFile();
		expect(new TextDecoder().decode(observation.bytes)).toContain(
			"ssh-ed25519",
		);
		expect(observation.attributes.uid).toBe(0);
		// What a key file must be under StrictModes.
		expect(observation.attributes.mode & permissionMask).toBe(keyFileMode);
	},
	testTimeoutMs,
);

test.skipIf(!hasDocker)(
	"reports a missing file instead of failing obscurely",
	async () => {
		await expect(readFile("/root/.ssh/not_here")).rejects.toMatchObject({
			code: "file_missing",
		});
	},
	testTimeoutMs,
);

test.skipIf(!hasDocker)(
	"refuses a host key that is not the pinned one",
	async () => {
		const observation = readSshFile({
			...connection,
			hostKey: Buffer.alloc(connection.hostKey.length),
			path: keyPath,
			maxBytes: readLimitBytes,
		});
		await expect(observation).rejects.toBeInstanceOf(SshError);
		await expect(observation).rejects.toMatchObject({
			code: "host_key_mismatch",
		});
	},
	testTimeoutMs,
);

test.skipIf(!hasDocker)(
	"appends an entry and preserves every other byte and the metadata",
	async () => {
		const observation = await readFile();
		const file = new AuthorizedKeysFile(observation.bytes);
		const added = ssh2.utils.generateKeyPairSync("ed25519").public.split(" ");
		const plan = file.plan(observation.bytes, [
			{
				kind: "append",
				key: { type: added[0] ?? "", base64: added[1] ?? "" },
				options: ['from="203.0.113.0/24"', "restrict"],
				comment: "appended",
			},
		]);
		expect(plan.ok).toBe(true);
		if (!plan.ok) {
			return;
		}
		const result = await writeSshFile(
			connection,
			keyPath,
			observation,
			plan.candidate,
		);
		expect(result.status).toBe("written");
		const after = await readFile();
		const text = new TextDecoder().decode(after.bytes);
		expect(text.startsWith(new TextDecoder().decode(observation.bytes))).toBe(
			true,
		);
		expect(text).toContain('from="203.0.113.0/24",restrict ');
		expect(after.attributes.mode).toBe(observation.attributes.mode);
		expect(after.attributes.uid).toBe(observation.attributes.uid);
	},
	testTimeoutMs,
);

test.skipIf(!hasDocker)(
	"reports an unchanged write, and refuses one against stale bytes",
	async () => {
		const observation = await readFile();
		const unchanged = await writeSshFile(
			connection,
			keyPath,
			observation,
			observation.bytes,
		);
		expect(unchanged.status).toBe("unchanged");
		exec("sh", "-c", `printf '# edited by hand\\n' >> ${keyPath}`);
		const stale = await writeSshFile(
			connection,
			keyPath,
			observation,
			new TextEncoder().encode("replaced\n"),
		);
		expect(stale.status).toBe("changed");
	},
	testTimeoutMs,
);

test.skipIf(!hasDocker)(
	"removes one occurrence and leaves the rest alone",
	async () => {
		const observation = await readFile();
		const file = new AuthorizedKeysFile(observation.bytes);
		const entry = file.lines.find(
			(line) => line.kind === "entry" && line.entry.comment === "appended",
		);
		expect(entry).toBeDefined();
		const result = await removeAuthorizedKeys(
			connection,
			keyPath,
			observation,
			[entry?.line ?? 0],
		);
		expect(result.status).toBe("written");
		const after = await readFile();
		const text = new TextDecoder().decode(after.bytes);
		expect(text).not.toContain("appended");
		expect(text).toContain("# edited by hand");
	},
	testTimeoutMs,
);

test.skipIf(!hasDocker)(
	"asks the server's own OpenSSH to judge a public key",
	async () => {
		const added = ssh2.utils.generateKeyPairSync("ed25519").public.split(" ");
		const parsed = await inspectSshPublicKey(connection, {
			type: added[0] ?? "",
			base64: added[1] ?? "",
		});
		expect(parsed).toMatchObject({ status: "parsed", type: "ED25519" });
		const rejected = await inspectSshPublicKey(connection, {
			type: "ssh-ed25519",
			base64: "AAAAC3NzaC1lZDI1NTE5AAAAIA==",
		});
		expect(rejected.status).toBe("rejected");
	},
	testTimeoutMs,
);

test.skipIf(!hasDocker)(
	"asks the server which accounts sign in with keys, and which files apply",
	async () => {
		const discovery = await discoverSshServer(connection);
		expect(discovery.port).toBe(sshPort);
		const root = discovery.accounts.find((account) => account.name === "root");
		expect(root).toMatchObject({
			acceptsPublicKeys: true,
			publicKeyAloneSignsIn: true,
		});
		expect(root?.sources).toContainEqual({
			kind: "file",
			path: keyPath,
			state: "present",
		});
		// A file the configuration names but nobody created is reported, not invented.
		expect(root?.sources).toContainEqual({
			kind: "file",
			path: "/root/.ssh/authorized_keys2",
			state: "missing",
		});
		expect(discovery.unknowns.length).toBeGreaterThan(0);
	},
	testTimeoutMs,
);

test.skipIf(!hasDocker)(
	"follows a moved key file and a key command instead of assuming defaults",
	async () => {
		exec(
			"sh",
			"-c",
			[
				"mkdir -p /etc/ssh/sshd_config.d /srv/keys",
				"printf 'AuthorizedKeysFile /srv/keys/%%u.keys\nAuthorizedKeysCommand /usr/local/bin/lookup\nAuthorizedKeysCommandUser nobody\n' > /etc/ssh/sshd_config.d/test.conf",
				"touch /srv/keys/root.keys && chmod 600 /srv/keys/root.keys",
			].join(" && "),
		);
		const discovery = await discoverSshServer(connection);
		const root = discovery.accounts.find((account) => account.name === "root");
		expect(root?.sources).toContainEqual({
			kind: "file",
			path: "/srv/keys/root.keys",
			state: "present",
		});
		expect(root?.sources).toContainEqual({
			kind: "command",
			command: "/usr/local/bin/lookup",
		});
		expect(discovery.unknowns).toContain(
			"A key command answers for each key and connection, so its keys cannot be listed.",
		);
		exec("rm", "-f", "/etc/ssh/sshd_config.d/test.conf");
	},
	testTimeoutMs,
);

test.skipIf(!hasDocker)(
	"leaves a hostname that no longer matches the name Composery gave it",
	async () => {
		const current = exec("hostname");
		expect(
			await setSshHostname(connection, {
				expected: "a-name-this-server-never-had",
				next: "renamed",
			}),
		).toBe(current);
		// Setting it to what it already is proves the write path without changing the server.
		expect(
			await setSshHostname(connection, { expected: current, next: current }),
		).toBe(current);
	},
	testTimeoutMs,
);

/** Writes one SSH server setting, and removes it after the check. */
async function withSetting<T>(setting: string, check: () => Promise<T>) {
	exec(
		"sh",
		"-c",
		`mkdir -p /etc/ssh/sshd_config.d && printf '%s\n' '${setting}' > /etc/ssh/sshd_config.d/check.conf`,
	);
	try {
		return await check();
	} finally {
		exec("rm", "-f", "/etc/ssh/sshd_config.d/check.conf");
	}
}

async function rootAccount() {
	const discovery = await discoverSshServer(connection);
	const root = discovery.accounts.find((account) => account.name === "root");
	if (root === undefined) {
		throw new Error("The container reported no root account.");
	}
	return { discovery, root };
}

test.skipIf(!hasDocker)(
	"reads a key file whose name the configuration quotes",
	async () => {
		exec(
			"sh",
			"-c",
			"touch '/root/.ssh/key file' && chmod 600 '/root/.ssh/key file'",
		);
		await withSetting('AuthorizedKeysFile "/root/.ssh/key file"', async () => {
			const { discovery, root } = await rootAccount();
			// The effective configuration prints the name unquoted, so both readings are reported.
			expect(root.sources).toContainEqual({
				kind: "file",
				path: "/root/.ssh/key file",
				state: "present",
			});
			expect(discovery.unknowns).toContain(
				"A key file's name holds a space, which the SSH server states in a way that cannot be split with certainty.",
			);
		});
	},
	testTimeoutMs,
);

test.skipIf(!hasDocker)(
	"does not pretend sshd expands a pattern that it reads literally",
	async () => {
		await withSetting("AuthorizedKeysFile /root/.ssh/*.keys", async () => {
			const { root } = await rootAccount();
			expect(root.sources).toContainEqual({
				kind: "file",
				path: "/root/.ssh/*.keys",
				state: "missing",
			});
		});
	},
	testTimeoutMs,
);

test.skipIf(!hasDocker)(
	"calls a file unsafe when a parent directory lets others write it",
	async () => {
		// Composery's own key file must stay safe, or this very connection would be refused.
		exec(
			"sh",
			"-c",
			"mkdir -p /srv/open && chmod 777 /srv/open && touch /srv/open/keys && chmod 600 /srv/open/keys",
		);
		await withSetting(
			`AuthorizedKeysFile ${keyPath} /srv/open/keys`,
			async () => {
				const { root } = await rootAccount();
				expect(root.sources).toContainEqual({
					kind: "file",
					path: "/srv/open/keys",
					state: "unsafe",
				});
				expect(root.sources).toContainEqual({
					kind: "file",
					path: keyPath,
					state: "present",
				});
			},
		);
	},
	testTimeoutMs,
);

test.skipIf(!hasDocker)(
	"calls a configured path that is not a regular file unusable",
	async () => {
		exec("mkdir", "-p", "/root/.ssh/directory_keys");
		await withSetting(
			"AuthorizedKeysFile /root/.ssh/directory_keys",
			async () => {
				const { root } = await rootAccount();
				expect(root.sources).toContainEqual({
					kind: "file",
					path: "/root/.ssh/directory_keys",
					state: "unusable",
				});
			},
		);
	},
	testTimeoutMs,
);

test.skipIf(!hasDocker)(
	"does not claim an account signs in with keys when the server forbids it",
	async () => {
		for (const setting of [
			"DenyUsers root",
			"PubkeyAuthentication no",
			"AuthenticationMethods password",
			"PermitRootLogin no",
		]) {
			await withSetting(setting, async () => {
				const { root } = await rootAccount();
				expect({ setting, ...root }).toMatchObject({
					setting,
					acceptsPublicKeys: false,
					publicKeyAloneSignsIn: false,
				});
			});
		}
	},
	testTimeoutMs,
);

test.skipIf(!hasDocker)(
	"says a key alone is not enough when the server asks for more",
	async () => {
		await withSetting("AuthenticationMethods publickey,password", async () => {
			const { root } = await rootAccount();
			expect(root).toMatchObject({
				acceptsPublicKeys: true,
				publicKeyAloneSignsIn: false,
			});
		});
	},
	testTimeoutMs,
);
