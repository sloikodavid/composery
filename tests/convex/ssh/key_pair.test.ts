import { beforeAll, expect, test } from "bun:test";
import { runSshCommand } from "../../../convex/ssh/connection";
import {
	generateSshKeyPair,
	type SshKeyPair,
} from "../../../convex/ssh/key_pair";
import {
	quoteShell,
	type SshdServer,
	useSshd,
} from "../../../harness/openssh/sshd";

const setupTimeoutMs = 300_000;
const testTimeoutMs = 60_000;
// One key in 256 starts with a zero byte, so missing one in this many tries has odds near e^-39.
const maxAttempts = 10_000;
const lengthPrefixBytes = 4;
const ed25519KeyBytes = 32;
// The public blob is the length-prefixed type "ssh-ed25519" followed by the key's own length prefix.
const keyBytesOffset =
	lengthPrefixBytes + "ssh-ed25519".length + lengthPrefixBytes;
const maxOutputBytes = 1024;

let server: SshdServer;

beforeAll(async () => {
	server = await useSshd();
}, setupTimeoutMs);

function toKeyBytes(pair: SshKeyPair) {
	return Buffer.from(pair.publicKey.split(" ")[1] ?? "", "base64").subarray(
		keyBytesOffset,
	);
}

function generateKeyStartingWithZero() {
	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const pair = generateSshKeyPair();
		if (toKeyBytes(pair)[0] === 0) {
			return pair;
		}
	}
	throw new Error("No generated key started with a zero byte.");
}

for (const [name, generate] of [
	["an ordinary key", generateSshKeyPair],
	[
		"a key whose first byte is zero, which a leading-zero encoder breaks",
		generateKeyStartingWithZero,
	],
] as const) {
	test(
		`OpenSSH reads ${name}, and it signs in`,
		async () => {
			const pair = generate();
			expect(toKeyBytes(pair)).toHaveLength(ed25519KeyBytes);
			server.run(
				`printf '%s' ${quoteShell(pair.privateKey)} > /tmp/key-pair-check && chmod 600 /tmp/key-pair-check`,
			);
			// OpenSSH derives the public key from our private key file, independently of our encoder.
			expect(server.run("ssh-keygen -y -f /tmp/key-pair-check")).toBe(
				pair.publicKey,
			);
			const account = server.createAccount();
			server.run(
				`printf '%s\\n' ${quoteShell(pair.publicKey)} > ${account.keyPath}`,
			);
			const result = await runSshCommand(
				{
					...server.connection,
					username: account.name,
					privateKey: pair.privateKey,
				},
				"id -un",
				{ maxOutputBytes },
			);
			expect(result.stdout.trim()).toBe(account.name);
		},
		testTimeoutMs,
	);
}
