import { afterAll, beforeAll, expect, test } from "bun:test";
import {
	runSshCommand,
	toSshProgramCommand,
	withSshConnection,
} from "../../../../convex/ssh/connection";
import { addressesScript } from "../../../../convex/ssh/scripts/addresses";
import { type SshdServer, startSshd } from "../../../../harness/openssh/sshd";

const setupTimeoutMs = 300_000;
const testTimeoutMs = 60_000;
const maxOutputBytes = 4096;
const globalScope = "00";
const scopeField = 3;
const fieldCount = 6;
const spaces = /\s+/;

let server: SshdServer;

const resources = new AsyncDisposableStack();

beforeAll(async () => {
	server = await startSshd();
	resources.defer(server.stop);
}, setupTimeoutMs);

async function run(command: string) {
	const result = await withSshConnection(
		server.connection,
		async (connection) =>
			await runSshCommand(connection, command, {
				maxOutputBytes,
			}),
	);
	expect(result.exitCode).toBe(0);
	return result.stdout;
}

test(
	"reports the addresses the kernel calls global, and none of the ones it does not",
	async () => {
		const file = await run("cat /proc/net/if_inet6");
		const entries = file
			.split("\n")
			.map((line) => line.split(spaces).filter(Boolean))
			.filter((fields) => fields.length >= fieldCount);
		expect(entries.length).toBeGreaterThan(0);
		const expected = entries.filter(
			(fields) => fields[scopeField] === globalScope,
		).length;

		const stdout = await run(toSshProgramCommand(addressesScript));
		const reported = (JSON.parse(stdout) as { ipv6: string[] }).ipv6;

		expect(reported).toHaveLength(expected);
		expect(reported).not.toContain("::1");
		expect(reported.some((address) => address.startsWith("fe80"))).toBe(false);
	},
	testTimeoutMs,
);

afterAll(() => resources.disposeAsync());
