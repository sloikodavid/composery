import { beforeAll, expect, test } from "bun:test";
import { setSshHostname } from "../../../convex/ssh/hostname";
import { type SshdServer, useSshd } from "../../../harness/openssh/sshd";

const setupTimeoutMs = 300_000;
const testTimeoutMs = 60_000;

let server: SshdServer;

beforeAll(async () => {
	server = await useSshd();
}, setupTimeoutMs);

test(
	"leaves a hostname that the owner changed away from the name Composery gave it",
	async () => {
		const current = server.run("hostname");
		expect(
			await setSshHostname(server.connection, {
				expected: "a-name-this-server-never-had",
				next: "renamed",
			}),
		).toBe(current);
		expect(server.run("hostname")).toBe(current);
	},
	testTimeoutMs,
);

test(
	"writes the hostname when it still holds the expected name",
	async () => {
		const current = server.run("hostname");
		expect(
			await setSshHostname(server.connection, {
				expected: current,
				next: current,
			}),
		).toBe(current);
	},
	testTimeoutMs,
);
