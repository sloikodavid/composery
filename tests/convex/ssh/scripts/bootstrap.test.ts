import { beforeAll, expect, test } from "bun:test";
import { discoverSshKeyAcceptance } from "../../../../convex/ssh/key_acceptance";
import { generateSshKeyPair } from "../../../../convex/ssh/key_pair";
import { renderSshBootstrapScript } from "../../../../convex/ssh/scripts/bootstrap";
import {
	quoteShell,
	type SshdServer,
	useSshd,
} from "../../../harness/openssh/sshd";

const setupTimeoutMs = 300_000;
const testTimeoutMs = 60_000;
// The report is the script's last step. A port that refuses connections makes it fail there,
// after the key file is written, so the test reads what a real run leaves behind.
const unreachableReportUrl = "https://127.0.0.1:1/ssh/host-keys";
// The report never happens here, so any token of the right length stands for one.
const tokenLength = 43;
const token = "a".repeat(tokenLength);

let server: SshdServer;

beforeAll(async () => {
	server = await useSshd();
}, setupTimeoutMs);

function toKey(publicKey: string) {
	const [type, base64] = publicKey.split(" ");
	return { type: type ?? "", base64: base64 ?? "" };
}

test(
	"renewal installs the new management key, removes the old one, and keeps every other key",
	async () => {
		const account = server.createAccount();
		const previous = generateSshKeyPair();
		const next = generateSshKeyPair();
		const personal = generateSshKeyPair();
		server.run(
			`printf '%s\n' ${quoteShell(`${previous.publicKey} composery`)} ${quoteShell(`${personal.publicKey} someone`)} > ${account.keyPath}`,
		);

		const script = renderSshBootstrapScript({
			bootstrapFile: {
				allocationId: "allocation",
				token,
				url: unreachableReportUrl,
			},
			publicKey: next.publicKey,
			previousPublicKey: previous.publicKey,
		});
		// The report fails, so the script's own exit code says nothing about the key file.
		server.run(
			`su -s /bin/sh -c ${quoteShell(script)} ${account.name} || true`,
		);

		const ask = (publicKey: string) =>
			discoverSshKeyAcceptance(
				{ ...server.connection, username: account.name },
				toKey(publicKey),
			);
		expect(await ask(next.publicKey)).toBe("accepted");
		expect(await ask(previous.publicKey)).toBe("refused");
		expect(await ask(personal.publicKey)).toBe("accepted");
	},
	testTimeoutMs,
);

test(
	"a second run of the same renewal leaves one copy of the new key",
	() => {
		const account = server.createAccount();
		const previous = generateSshKeyPair();
		const next = generateSshKeyPair();
		server.run(
			`printf '%s\n' ${quoteShell(`${previous.publicKey} composery`)} > ${account.keyPath}`,
		);
		const script = renderSshBootstrapScript({
			bootstrapFile: {
				allocationId: "allocation",
				token,
				url: unreachableReportUrl,
			},
			publicKey: next.publicKey,
			previousPublicKey: previous.publicKey,
		});
		const run = () =>
			server.run(
				`su -s /bin/sh -c ${quoteShell(script)} ${account.name} || true`,
			);
		run();
		run();

		expect(
			server
				.run(
					`grep -c ${quoteShell(next.publicKey.split(" ")[1] ?? "")} ${account.keyPath}`,
				)
				.trim(),
		).toBe("1");
	},
	testTimeoutMs,
);
