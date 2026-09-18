import { beforeAll, expect, test } from "bun:test";
import {
	runSshCommand,
	toSshProgramCommand,
} from "../../../../convex/ssh/connection";
import { addressesScript } from "../../../../convex/ssh/scripts/addresses";
import { type SshdServer, useSshd } from "../../../../harness/openssh/sshd";

const setupTimeoutMs = 300_000;
const testTimeoutMs = 60_000;
const maxOutputBytes = 4096;
const globalScope = "00";
const scopeField = 3;
const fieldCount = 6;
const spaces = /\s+/;

let server: SshdServer;

beforeAll(async () => {
	server = await useSshd();
}, setupTimeoutMs);

async function run(command: string) {
	const result = await runSshCommand(server.connection, command, {
		maxOutputBytes,
	});
	expect(result.exitCode).toBe(0);
	return result.stdout;
}

test(
	"reports the addresses the kernel calls global, and none of the ones it does not",
	async () => {
		// The kernel's own list is the authority, so the test reads the same file and works out the
		// answer for itself. A container has a loopback address and a link-local one and, unless it
		// was given a network of its own, no global address at all: then both sides say none, and
		// what is proved is that the program reads the file, filters it and answers in the shape a
		// caller reads. Where the machine does have one, the count catches a program that missed it.
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
		// Neither of the two a container always has reaches anything outside it.
		expect(reported).not.toContain("::1");
		expect(reported.some((address) => address.startsWith("fe80"))).toBe(false);
	},
	testTimeoutMs,
);
