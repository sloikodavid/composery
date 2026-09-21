import { beforeAll, expect, test } from "bun:test";
import { setSshHostname } from "../../../convex/ssh/hostname";
import { quoteShell } from "../../../convex/ssh/scripts/shell";
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

test(
	"reports a failed native hostname command without changing the value",
	async () => {
		const current = server.run("hostname");
		server.run(
			"printf '%s\\n' '#!/bin/sh' 'exit 1' > /usr/local/bin/hostnamectl && chmod 755 /usr/local/bin/hostnamectl",
		);
		try {
			await expect(
				setSshHostname(server.connection, {
					expected: current,
					next: `${current}-changed`,
				}),
			).rejects.toMatchObject({ code: "command_unavailable" });
		} finally {
			server.run(`rm -f ${quoteShell("/usr/local/bin/hostnamectl")}`);
		}
		expect(server.run("hostname")).toBe(current);
	},
	testTimeoutMs,
);
