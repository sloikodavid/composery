/// <reference types="bun" />

import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import ssh2 from "ssh2";
import { discoverSshAccounts } from "./accounts";
import { AuthorizedKeysFile } from "./authorized_keys";
import { type SshConnectionOptions, SshError } from "./connection";
import { inspectSshPublicKey } from "./inspect_public_key";
import { readSshFile } from "./read_file";
import { removeAuthorizedKeys } from "./remove_authorized_keys";
import { writeSshFile } from "./write_file";

/**
 * Runs the real remote operations against a real OpenSSH server in a container, because the
 * guarantees they claim - preserved bytes, preserved metadata, a refused write after a change -
 * exist only in the interaction with sshd, not in our own code. Skipped where Docker is absent.
 */
const image = "composery-machine-test";
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
	"asks the machine's own OpenSSH to judge a public key",
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
	"asks the machine which accounts sign in with keys, and which files apply",
	async () => {
		const machine = await discoverSshAccounts(connection);
		expect(machine.port).toBe(sshPort);
		const root = machine.accounts.find((account) => account.name === "root");
		expect(root).toMatchObject({ keysEnabled: true, keyAloneSignsIn: true });
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
		expect(machine.limits.length).toBeGreaterThan(0);
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
		const machine = await discoverSshAccounts(connection);
		const root = machine.accounts.find((account) => account.name === "root");
		expect(root?.sources).toContainEqual({
			kind: "file",
			path: "/srv/keys/root.keys",
			state: "present",
		});
		expect(root?.sources).toContainEqual({
			kind: "command",
			command: "/usr/local/bin/lookup",
		});
		expect(machine.limits).toContain(
			"A key command answers for each key and connection, so its keys cannot be listed.",
		);
		exec("rm", "-f", "/etc/ssh/sshd_config.d/test.conf");
	},
	testTimeoutMs,
);
