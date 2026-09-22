import { afterAll, beforeAll, expect, test } from "bun:test";
import { withSshConnection } from "../../../convex/ssh/connection";
import { discoverSshServer } from "../../../convex/ssh/discovery";
import { type SshdServer, startSshd } from "../../../harness/openssh/sshd";

const setupTimeoutMs = 300_000;
const testTimeoutMs = 60_000;
const rootKeyPath = "/root/.ssh/authorized_keys";

let server: SshdServer;

const resources = new AsyncDisposableStack();

beforeAll(async () => {
	server = await startSshd();
	resources.defer(server.stop);
}, setupTimeoutMs);

async function discoverRoot() {
	const discovery = await withSshConnection(
		server.connection,
		async (connection) => await discoverSshServer(connection),
	);
	const root = discovery.accounts.find((account) => account.name === "root");
	if (root === undefined) {
		throw new Error("The server reported no root account.");
	}
	return { discovery, root };
}

test(
	"reports the key files that apply, including one the configuration names and nobody created",
	async () => {
		const { discovery, root } = await discoverRoot();
		expect(root).toMatchObject({
			acceptsPublicKeys: true,
			publicKeyAloneSignsIn: true,
		});
		expect(root.sources).toContainEqual({
			kind: "file",
			path: rootKeyPath,
			status: "present",
		});
		expect(root.sources).toContainEqual({
			kind: "file",
			path: "/root/.ssh/authorized_keys2",
			status: "missing",
		});
		expect(discovery.unknowns).toContain(
			"The SSH server's configuration was read from disk, which the running daemon need not have reloaded.",
		);
	},
	testTimeoutMs,
);

test(
	"follows a moved key file and a key command instead of assuming the defaults",
	async () => {
		server.run(
			"mkdir -p /srv/moved && touch /srv/moved/root.keys && chmod 600 /srv/moved/root.keys",
		);
		const setting = [
			`AuthorizedKeysFile ${rootKeyPath} /srv/moved/%u.keys`,
			"AuthorizedKeysCommand /usr/local/bin/lookup",
			"AuthorizedKeysCommandUser nobody",
		].join("\n");
		await server.withSettingOnDisk(setting, async () => {
			const { discovery, root } = await discoverRoot();
			expect(root.sources).toContainEqual({
				kind: "file",
				path: "/srv/moved/root.keys",
				status: "present",
			});
			expect(root.sources).toContainEqual({
				kind: "command",
				command: "/usr/local/bin/lookup",
			});
			expect(discovery.unknowns).toContain(
				"A key command answers for each key and connection, so its keys cannot be listed.",
			);
		});
	},
	testTimeoutMs,
);

test(
	"uses native directive boundaries for a quoted key file name",
	async () => {
		server.run(
			"touch '/root/.ssh/key file' && chmod 600 '/root/.ssh/key file'",
		);
		await server.withSettingOnDisk(
			'AuthorizedKeysFile "/root/.ssh/key file"',
			async () => {
				const { discovery, root } = await discoverRoot();
				expect(root.sources).toContainEqual({
					kind: "file",
					path: "/root/.ssh/key file",
					status: "present",
				});
				expect(discovery.unknowns).not.toContain(
					"A key file's name holds a space, which the SSH server states in a way that cannot be split with certainty.",
				);
			},
		);
	},
	testTimeoutMs,
);

test(
	"does not guess file boundaries when native directives have the same effective text",
	async () => {
		await server.withSettingOnDisk(
			'AuthorizedKeysFile "/root/.ssh/key file"\nAuthorizedKeysFile /root/.ssh/key file',
			async () => {
				const { discovery, root } = await discoverRoot();
				expect(root.sources.filter((source) => source.kind === "file")).toEqual(
					[],
				);
				expect(discovery.unknowns).toContain(
					"A key file's name holds a space, which the SSH server states in a way that cannot be split with certainty.",
				);
			},
		);
	},
	testTimeoutMs,
);

test(
	"does not expand a pattern that the server reads literally",
	async () => {
		server.run("touch /root/.ssh/one.keys && chmod 600 /root/.ssh/one.keys");
		await server.withSettingOnDisk(
			"AuthorizedKeysFile /root/.ssh/*.keys",
			async () => {
				const { root } = await discoverRoot();
				expect(root.sources).toContainEqual({
					kind: "file",
					path: "/root/.ssh/*.keys",
					status: "missing",
				});
				expect(root.sources).not.toContainEqual({
					kind: "file",
					path: "/root/.ssh/one.keys",
					status: "present",
				});
			},
		);
	},
	testTimeoutMs,
);

test(
	"calls a file unsafe when a parent directory lets others write it, and unusable when it is not a file",
	async () => {
		server.run(
			"mkdir -p /srv/open /root/.ssh/directory_keys && chmod 777 /srv/open && touch /srv/open/keys && chmod 600 /srv/open/keys",
		);
		await server.withSettingOnDisk(
			`AuthorizedKeysFile ${rootKeyPath} /srv/open/keys /root/.ssh/directory_keys`,
			async () => {
				const { root } = await discoverRoot();
				expect(root.sources).toContainEqual({
					kind: "file",
					path: "/srv/open/keys",
					status: "unsafe",
				});
				expect(root.sources).toContainEqual({
					kind: "file",
					path: "/root/.ssh/directory_keys",
					status: "unusable",
				});
				expect(root.sources).toContainEqual({
					kind: "file",
					path: rootKeyPath,
					status: "present",
				});
			},
		);
	},
	testTimeoutMs,
);

test(
	"calls a symbolic-link key source unsafe because edits do not follow it",
	async () => {
		server.run(
			"touch /root/.ssh/real_keys && chmod 600 /root/.ssh/real_keys && ln -sf /root/.ssh/real_keys /root/.ssh/link_keys",
		);
		await server.withSettingOnDisk(
			"AuthorizedKeysFile /root/.ssh/link_keys",
			async () => {
				const { root } = await discoverRoot();
				expect(root.sources).toContainEqual({
					kind: "file",
					path: "/root/.ssh/link_keys",
					status: "unsafe",
				});
			},
		);
	},
	testTimeoutMs,
);

test(
	"does not claim that keys sign in to an account when the server forbids it",
	async () => {
		for (const setting of [
			"DenyUsers root",
			"PubkeyAuthentication no",
			"AuthenticationMethods password",
			"PermitRootLogin no",
		]) {
			await server.withSettingOnDisk(setting, async () => {
				const { root } = await discoverRoot();
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

test(
	"says that a key alone does not sign in when the server also asks for a password",
	async () => {
		await server.withSettingOnDisk(
			"AuthenticationMethods publickey,password",
			async () => {
				const { root } = await discoverRoot();
				expect(root).toMatchObject({
					acceptsPublicKeys: true,
					publicKeyAloneSignsIn: false,
				});
			},
		);
	},
	testTimeoutMs,
);

afterAll(() => resources.disposeAsync());
