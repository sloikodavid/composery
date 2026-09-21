import { beforeAll, expect, test } from "bun:test";
import { api, internal } from "../../../convex/_generated/api";
import { toAccessStatus } from "../../../convex/ssh/access";
import { SshAccessError, SshError } from "../../../convex/ssh/errors";
import {
	type ConvexBackend,
	useConvexBackend,
} from "../../../harness/convex/backend";
import { useHetznerFake } from "../../../harness/hetzner/fake";
import {
	createServer,
	createServerOwner,
	readServerBackendRecord,
	settleServer,
} from "../../../harness/servers";

const setupTimeoutMs = 600_000;
const testTimeoutMs = 300_000;

let backend: ConvexBackend;

beforeAll(async () => {
	backend = await useConvexBackend();
	await useHetznerFake();
}, setupTimeoutMs);

test("tells a refusal apart from an attempt that never happened", () => {
	// Authentication refusal means the server answered; transport failure does not.
	expect(toAccessStatus(new SshError("authentication_failed"))).toBe("missing");
	expect(toAccessStatus(new SshError("permission_denied"))).toBe("missing");
	expect(toAccessStatus(new SshError("host_key_mismatch"))).toBe("mismatch");
	expect(toAccessStatus(new SshError("connection_failed"))).toBe("unknown");
	expect(toAccessStatus(new SshError("deadline_exceeded"))).toBe("unknown");
	expect(toAccessStatus(new SshAccessError("host_key_missing"))).toBe(
		"unknown",
	);
	expect(toAccessStatus(new SshAccessError("secrets_unreadable"))).toBe(
		"unknown",
	);
	expect(toAccessStatus(new Error("something else"))).toBe("unknown");
});

test(
	"a server that has never reported a host key is unknown, says so by code, and no address is invented",
	async () => {
		const client = await createServerOwner(backend);
		const serverId = await createServer(client);
		await settleServer(backend, client, serverId, { until: "running" });
		const allocationId = (await readServerBackendRecord(backend, serverId))
			?.allocation._id;
		if (allocationId === undefined) {
			throw new Error("The server has no allocation.");
		}

		await backend.runAsAdmin(internal.ssh.access.check, { allocationId });

		const status = await client.query(api.servers.lifecycle.getStatus, {
			serverId,
		});
		expect(status.parts.managementAccess).toBe("unknown");
		expect(status.features.sshKeys.status).toBe("unknown");
		expect(status.ipv6Network).not.toBe(null);
		expect(status.ipv6).toBe(null);
		// Composery's own missing access is a code the caller can act on, not a server error.
		await expect(
			client.action(api.ssh.keys.list, { serverId }),
		).rejects.toMatchObject({ data: { code: "server_unreachable" } });
	},
	testTimeoutMs,
);
