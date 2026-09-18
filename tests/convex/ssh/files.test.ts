import { beforeAll, expect, test } from "bun:test";
import {
	type AuthorizedKey,
	type AuthorizedKeysEdit,
	AuthorizedKeysFile,
} from "../../../convex/ssh/authorized_keys";
import { SshError } from "../../../convex/ssh/errors";
import { discoverSshKeyAcceptance } from "../../../convex/ssh/key_acceptance";
import { readSshFile } from "../../../convex/ssh/read_file";
import { writeSshFile } from "../../../convex/ssh/write_file";
import { generateAuthorizedKey } from "../../harness/openssh/keys";
import {
	quoteShell,
	type SshdAccount,
	type SshdServer,
	useSshd,
} from "../../harness/openssh/sshd";

const setupTimeoutMs = 300_000;
const testTimeoutMs = 60_000;
const readLimitBytes = 65_536;
const keyFileMode = 0o600;
const permissionMask = 0o777;
const decoder = new TextDecoder();

let server: SshdServer;

beforeAll(async () => {
	server = await useSshd();
}, setupTimeoutMs);

function writeKeyFile(account: SshdAccount, lines: readonly string[]) {
	server.run(
		`printf '%s\\n' ${lines.map(quoteShell).join(" ")} > ${account.keyPath}`,
	);
}

function readKeyFile(account: SshdAccount) {
	return readSshFile({
		...server.connection,
		path: account.keyPath,
		maxBytes: readLimitBytes,
	});
}

function askAbout(account: SshdAccount, key: AuthorizedKey) {
	return discoverSshKeyAcceptance(
		{ ...server.connection, username: account.name },
		key,
	);
}

/** Plans edits against the file as it is now, writes them, and returns the file as it was before. */
async function editKeyFile(
	account: SshdAccount,
	edits: (file: AuthorizedKeysFile) => AuthorizedKeysEdit[],
) {
	const before = await readKeyFile(account);
	const file = new AuthorizedKeysFile(before.bytes);
	const plan = file.plan(before.bytes, edits(file));
	if (!plan.ok) {
		throw new Error(`The edit was refused before writing: ${plan.reason}`);
	}
	const result = await writeSshFile(
		server.connection,
		account.keyPath,
		before,
		plan.candidate,
	);
	return { before, result };
}

function findLine(file: AuthorizedKeysFile, comment: string) {
	const found = file.lines.find(
		(line) => line.kind === "entry" && line.entry.comment === comment,
	);
	if (found === undefined) {
		throw new Error(`No line has the comment ${comment}.`);
	}
	return found.line;
}

test(
	"reads a file with its bytes and the owner and mode that StrictModes checks",
	async () => {
		const account = server.createAccount();
		const key = generateAuthorizedKey();
		writeKeyFile(account, [`${key.type} ${key.base64} owned`]);
		const observation = await readKeyFile(account);
		expect(decoder.decode(observation.bytes)).toBe(
			`${key.type} ${key.base64} owned\n`,
		);
		expect(observation.attributes.uid).toBe(
			Number(server.run(`id -u ${account.name}`)),
		);
		expect(observation.attributes.mode & permissionMask).toBe(keyFileMode);
	},
	testTimeoutMs,
);

test(
	"reports a missing file, and refuses a server whose host key is not the pinned one",
	async () => {
		const account = server.createAccount();
		await expect(
			readSshFile({
				...server.connection,
				path: `${account.home}/.ssh/not_here`,
				maxBytes: readLimitBytes,
			}),
		).rejects.toMatchObject({ code: "file_missing" });
		const impostor = readSshFile({
			...server.connection,
			hostKey: Buffer.alloc(server.connection.hostKey.length),
			path: account.keyPath,
			maxBytes: readLimitBytes,
		});
		await expect(impostor).rejects.toBeInstanceOf(SshError);
		await expect(impostor).rejects.toMatchObject({
			code: "host_key_mismatch",
		});
	},
	testTimeoutMs,
);

test(
	"an append keeps every byte and the metadata, and the server accepts both keys afterwards",
	async () => {
		const account = server.createAccount();
		const held = generateAuthorizedKey();
		const added = generateAuthorizedKey();
		// Bytes that a careless rewrite would normalize: a comment, a blank line, and tabs.
		writeKeyFile(account, [
			"# kept by hand",
			"",
			`${held.type}\t${held.base64}\tkept`,
		]);
		const { before, result } = await editKeyFile(account, () => [
			{ kind: "append", key: added, options: [], comment: "added" },
		]);
		expect(result.status).toBe("written");
		const after = await readKeyFile(account);
		expect(
			decoder.decode(after.bytes).startsWith(decoder.decode(before.bytes)),
		).toBe(true);
		expect(after.attributes.mode).toBe(before.attributes.mode);
		expect(after.attributes.uid).toBe(before.attributes.uid);
		expect(after.attributes.gid).toBe(before.attributes.gid);
		expect(await askAbout(account, held)).toBe("accepted");
		expect(await askAbout(account, added)).toBe("accepted");
	},
	testTimeoutMs,
);

test(
	"restricting a key's options narrows what the server allows, and leaves its neighbour alone",
	async () => {
		const account = server.createAccount();
		const restricted = generateAuthorizedKey();
		const neighbour = generateAuthorizedKey();
		writeKeyFile(account, [
			`${restricted.type} ${restricted.base64} restricted`,
			`${neighbour.type} ${neighbour.base64} neighbour`,
		]);
		expect(await askAbout(account, restricted)).toBe("accepted");
		const { result } = await editKeyFile(account, (file) => [
			{
				kind: "update",
				line: findLine(file, "restricted"),
				options: ['from="198.51.100.7"'],
			},
		]);
		expect(result.status).toBe("written");
		expect(await askAbout(account, restricted)).toBe("refused");
		expect(await askAbout(account, neighbour)).toBe("accepted");
	},
	testTimeoutMs,
);

test(
	"removes one occurrence of a key that appears twice, so the server still accepts it until the last one goes",
	async () => {
		const account = server.createAccount();
		const key = generateAuthorizedKey();
		writeKeyFile(account, [
			`${key.type} ${key.base64} first`,
			`${key.type} ${key.base64} second`,
		]);
		const first = await editKeyFile(account, (file) => [
			{ kind: "remove", line: findLine(file, "first") },
		]);
		expect(first.result.status).toBe("written");
		expect(decoder.decode((await readKeyFile(account)).bytes)).toBe(
			`${key.type} ${key.base64} second\n`,
		);
		expect(await askAbout(account, key)).toBe("accepted");
		const second = await editKeyFile(account, (file) => [
			{ kind: "remove", line: findLine(file, "second") },
		]);
		expect(second.result.status).toBe("written");
		expect(await askAbout(account, key)).toBe("refused");
	},
	testTimeoutMs,
);

test(
	"reports an unchanged write, and refuses a write planned against bytes that changed since",
	async () => {
		const account = server.createAccount();
		const key = generateAuthorizedKey();
		writeKeyFile(account, [`${key.type} ${key.base64} original`]);
		const observation = await readKeyFile(account);
		const unchanged = await writeSshFile(
			server.connection,
			account.keyPath,
			observation,
			observation.bytes,
		);
		expect(unchanged.status).toBe("unchanged");
		server.run(`printf '# edited by hand\\n' >> ${account.keyPath}`);
		const stale = await writeSshFile(
			server.connection,
			account.keyPath,
			observation,
			new TextEncoder().encode("replaced\n"),
		);
		expect(stale.status).toBe("changed");
		expect(decoder.decode((await readKeyFile(account)).bytes)).toBe(
			`${key.type} ${key.base64} original\n# edited by hand\n`,
		);
	},
	testTimeoutMs,
);
