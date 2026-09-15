import { beforeAll, expect, test } from "bun:test";
import { SshError } from "../../../convex/ssh/connection";
import { discoverSshKeyAcceptance } from "../../../convex/ssh/key_acceptance";
import { generateAuthorizedKey } from "../../harness/keys";
import {
	quoteShell,
	type SshdAccount,
	type SshdServer,
	sshdLogPath,
	useSshd,
} from "../../harness/sshd";

const setupTimeoutMs = 300_000;
const testTimeoutMs = 60_000;

let server: SshdServer;

beforeAll(async () => {
	server = await useSshd();
}, setupTimeoutMs);

function writeKeyFile(account: SshdAccount, lines: readonly string[]) {
	server.run(
		`printf '%s\\n' ${lines.map(quoteShell).join(" ")} > ${account.keyPath}`,
	);
}

function askAbout(
	username: string,
	key: Readonly<{ type: string; base64: string }>,
) {
	return discoverSshKeyAcceptance({ ...server.connection, username }, key);
}

test(
	"accepts the key that the account's file holds, and refuses one it does not",
	async () => {
		const account = server.createAccount();
		const held = generateAuthorizedKey();
		writeKeyFile(account, [`${held.type} ${held.base64} held`]);
		expect(await askAbout(account.name, held)).toBe("accepted");
		expect(await askAbout(account.name, generateAuthorizedKey())).toBe(
			"refused",
		);
	},
	testTimeoutMs,
);

test(
	"refuses a key for an account that does not exist",
	async () => {
		expect(
			await askAbout("nobody-has-this-name", generateAuthorizedKey()),
		).toBe("refused");
	},
	testTimeoutMs,
);

test(
	"judges from Composery's address, so a key limited to another address is refused",
	async () => {
		const account = server.createAccount();
		const key = generateAuthorizedKey();
		writeKeyFile(account, [`from="198.51.100.7" ${key.type} ${key.base64}`]);
		expect(await askAbout(account.name, key)).toBe("refused");
	},
	testTimeoutMs,
);

test(
	"refuses an expired key and accepts a restricted one, because restrictions apply after sign-in",
	async () => {
		const account = server.createAccount();
		const expired = generateAuthorizedKey();
		const restricted = generateAuthorizedKey();
		writeKeyFile(account, [
			`expiry-time="20200101" ${expired.type} ${expired.base64}`,
			`restrict,command="true" ${restricted.type} ${restricted.base64}`,
		]);
		expect(await askAbout(account.name, expired)).toBe("refused");
		expect(await askAbout(account.name, restricted)).toBe("accepted");
	},
	testTimeoutMs,
);

test(
	"refuses a key in a file that other users can write",
	async () => {
		const account = server.createAccount();
		const key = generateAuthorizedKey();
		writeKeyFile(account, [`${key.type} ${key.base64}`]);
		server.run(`chmod 666 ${account.keyPath}`);
		expect(await askAbout(account.name, key)).toBe("refused");
	},
	testTimeoutMs,
);

test(
	"sees an edit to the file at once, because the server reads it for each connection",
	async () => {
		const account = server.createAccount();
		const key = generateAuthorizedKey();
		expect(await askAbout(account.name, key)).toBe("refused");
		writeKeyFile(account, [`${key.type} ${key.base64}`]);
		expect(await askAbout(account.name, key)).toBe("accepted");
	},
	testTimeoutMs,
);

test(
	"answers for the running server, not for a setting that is only on disk",
	async () => {
		const account = server.createAccount();
		const key = generateAuthorizedKey();
		writeKeyFile(account, [`${key.type} ${key.base64}`]);
		const setting = `DenyUsers ${account.name}`;
		await server.withSettingOnDisk(setting, async () => {
			expect(await askAbout(account.name, key)).toBe("accepted");
		});
		await server.withSettingApplied(setting, async () => {
			expect(await askAbout(account.name, key)).toBe("refused");
		});
		expect(await askAbout(account.name, key)).toBe("accepted");
	},
	testTimeoutMs,
);

test(
	"never signs in, even when the key is accepted",
	async () => {
		const account = server.createAccount();
		const key = generateAuthorizedKey();
		writeKeyFile(account, [`${key.type} ${key.base64}`]);
		expect(await askAbout(account.name, key)).toBe("accepted");
		const log = server.run(`cat ${sshdLogPath}`);
		// The connection ends while the account is still being authenticated, and no login is logged.
		expect(log).toContain(
			`Disconnected from authenticating user ${account.name} `,
		);
		expect(log).not.toContain(`Accepted publickey for ${account.name}`);
	},
	testTimeoutMs,
);

test(
	"gives no answer from a server whose host key is not the pinned one",
	async () => {
		const account = server.createAccount();
		const key = generateAuthorizedKey();
		writeKeyFile(account, [`${key.type} ${key.base64}`]);
		const impostor = discoverSshKeyAcceptance(
			{
				...server.connection,
				username: account.name,
				hostKey: Buffer.alloc(server.connection.hostKey.length),
			},
			key,
		);
		await expect(impostor).rejects.toBeInstanceOf(SshError);
		await expect(impostor).rejects.toMatchObject({
			code: "host_key_mismatch",
		});
	},
	testTimeoutMs,
);
