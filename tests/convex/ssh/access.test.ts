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
	// The server answered and said no. That is the one thing that means our key is gone.
	expect(toAccessStatus(new SshError("authentication_failed"))).toBe("missing");
	expect(toAccessStatus(new SshError("permission_denied"))).toBe("missing");
	// The server answered with a key that is not the one we pinned.
	expect(toAccessStatus(new SshError("host_key_mismatch"))).toBe("mismatch");
	// Nothing was asked of the server, so nothing about it was established.
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
	"a server that has never reported a host key is unknown, and no address is invented",
	async () => {
		const client = await createServerOwner(backend);
		const serverId = await createServer(client);
		await settleServer(backend, client, serverId, { until: "running" });
		const allocationId = (await readServerBackendRecord(backend, serverId))
			?.allocation._id;
		if (allocationId === undefined) {
			throw new Error("The server has no allocation.");
		}

		// Nothing has pinned a host key, so there is nothing to check the server against and no
		// connection is made. Saying the key is gone would blame the server for our own silence.
		await backend.runAsAdmin(internal.ssh.access.check, { allocationId });

		const status = await client.query(api.servers.lifecycle.getStatus, {
			serverId,
		});
		expect(status.parts.managementAccess).toBe("unknown");
		expect(status.features.sshKeys.status).toBe("unknown");
		// The provider gave the allocation a range; which address answers is still unknown.
		expect(status.ipv6Network).not.toBe(null);
		expect(status.ipv6).toBe(null);
	},
	testTimeoutMs,
);
