import { expect, test } from "bun:test";
import {
	runSshCommand,
	toSshAccessStatus,
	withSshConnection,
} from "../../../convex/ssh/connection";
import { discoverSshServer } from "../../../convex/ssh/discovery";
import { SshAccessError, SshError } from "../../../convex/ssh/errors";
import { discoverSshKeyAcceptance } from "../../../convex/ssh/key_acceptance";
import { readSshFile } from "../../../convex/ssh/read_file";
import { writeSshFile } from "../../../convex/ssh/write_file";
import { generateAuthorizedKey } from "../../../harness/openssh/keys";
import { sshdLogPath, startSshd } from "../../../harness/openssh/sshd";

const testTimeoutMs = 300_000;
const maxBytes = 65_536;
const acceptedLoginPattern = /Accepted publickey for root /g;

test("tells a refusal apart from an attempt that never happened", () => {
	// Authentication refusal means the server answered; transport failure does not.
	expect(toSshAccessStatus(new SshError("authentication_failed"))).toBe(
		"missing",
	);
	expect(toSshAccessStatus(new SshError("permission_denied"))).toBe("unknown");
	expect(toSshAccessStatus(new SshError("host_key_mismatch"))).toBe("mismatch");
	expect(toSshAccessStatus(new SshError("connection_failed"))).toBe("unknown");
	expect(toSshAccessStatus(new SshError("deadline_exceeded"))).toBe("unknown");
	expect(toSshAccessStatus(new SshAccessError("host_key_missing"))).toBe(
		"unknown",
	);
	expect(toSshAccessStatus(new SshAccessError("secrets_unreadable"))).toBe(
		"unknown",
	);
	expect(toSshAccessStatus(new Error("something else"))).toBe("unknown");
});

test(
	"one management connection supports the complete edit and survives file errors",
	async () => {
		await using resources = new AsyncDisposableStack();
		const server = await startSshd();
		resources.defer(server.stop);
		const account = server.createAccount();
		const key = generateAuthorizedKey();
		const candidate = new TextEncoder().encode(
			`${key.type} ${key.base64} connection-test\n`,
		);
		const loginsBefore =
			server.run(`cat ${sshdLogPath}`).match(acceptedLoginPattern)?.length ?? 0;
		await withSshConnection(server.connection, async (connection) => {
			const discovery = await discoverSshServer(connection);
			expect(discovery.accounts.some(({ name }) => name === account.name)).toBe(
				true,
			);
			const before = await readSshFile(connection, {
				path: account.keyPath,
				maxBytes,
			});
			expect(
				(await writeSshFile(connection, account.keyPath, before, candidate))
					.status,
			).toBe("written");
			expect(
				await discoverSshKeyAcceptance(
					{ ...connection.target, username: account.name },
					key,
				),
			).toBe("accepted");
			expect(
				(await readSshFile(connection, { path: account.keyPath, maxBytes }))
					.bytes,
			).toEqual(candidate);
			await expect(
				readSshFile(connection, { path: `${account.home}/missing`, maxBytes }),
			).rejects.toMatchObject({ code: "file_missing" });
			expect(connection.getAccessStatus()).toBe("ok");
			await expect(
				readSshFile(connection, { path: "relative", maxBytes }),
			).rejects.toMatchObject({ code: "invalid_request" });
			expect(connection.getAccessStatus()).toBe("ok");
			expect(
				(
					await runSshCommand(connection, "printf ready", {
						maxOutputBytes: maxBytes,
					})
				).stdout,
			).toBe("ready");
		});
		const loginsAfter =
			server.run(`cat ${sshdLogPath}`).match(acceptedLoginPattern)?.length ?? 0;
		expect(loginsAfter - loginsBefore).toBe(1);
		await withSshConnection(server.connection, async (connection) => {
			await new Promise<void>((resolve) => {
				connection.client.once("close", resolve);
				connection.client.destroy();
			});
			expect(connection.getAccessStatus()).toBe("unknown");
		});
	},
	testTimeoutMs,
);
