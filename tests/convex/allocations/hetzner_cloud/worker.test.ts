import { beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { api, internal } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
	type ConvexBackend,
	useConvexBackend,
} from "../../../../harness/convex/backend";
import {
	type HetznerFake,
	useHetznerFake,
} from "../../../../harness/hetzner/fake";
import {
	createServer,
	createServerOwner,
	readServerBackendRecord,
	readServerStatus,
	requireHetznerServerId,
	type ServerClient,
	settleServer,
} from "../../../../harness/servers";

const setupTimeoutMs = 600_000;
const testTimeoutMs = 300_000;
const subjectSuffixBytes = 6;
const waitingTimeoutMs = 420_000;
const waitingTestTimeoutMs = 600_000;
const forbidden = 403;
const createdServers = /^\/servers$/;
const createdPrimaryIps = /^\/primary_ips$/;
// Firewall repair follows the requested power action and its own worker cycle.
const partTimeoutMs = 120_000;
const partDelayMs = 500;

let backend: ConvexBackend;
let fake: HetznerFake;

beforeAll(async () => {
	backend = await useConvexBackend();
	fake = await useHetznerFake();
}, setupTimeoutMs);

async function requireAllocationId(serverId: Id<"servers">) {
	const allocationId = (await readServerBackendRecord(backend, serverId))
		?.allocation._id;
	if (allocationId === undefined) {
		throw new Error("The server has no allocation.");
	}
	return allocationId;
}

function isForAllocation(allocationId: string) {
	return (body: unknown) =>
		(body as { labels?: Record<string, string> } | undefined)?.labels?.[
			"allocation-id"
		] === allocationId;
}

async function readOwnedResources(allocationId: string) {
	const reply = await fetch(
		`${fake.url}/v1/servers?label_selector=allocation-id=${allocationId}`,
	);
	const servers = ((await reply.json()) as { servers: unknown[] }).servers;
	const addressReply = await fetch(
		`${fake.url}/v1/primary_ips?label_selector=allocation-id=${allocationId}`,
	);
	// biome-ignore lint/style/useNamingConvention: external collection name
	const addresses = ((await addressReply.json()) as { primary_ips: unknown[] })
		.primary_ips;
	return [...servers, ...addresses];
}

test(
	"a created server reaches running, with one server and two addresses at the provider",
	async () => {
		const client = await createServerOwner(backend);
		// Lose only the server-create reply after the allocation ID is known.
		const serverId = await createServer(client);
		const status = await settleServer(backend, client, serverId, {
			until: "running",
		});
		const allocationId = await requireAllocationId(serverId);

		expect(status.status).toBe("running");
		expect(status.ipv4).not.toBe(null);
		await expect(
			fake.countRequests({
				method: "POST",
				path: createdServers,
				body: isForAllocation(allocationId),
			}),
		).toBe(1);
		expect(
			fake.countRequests({
				method: "POST",
				path: createdPrimaryIps,
				body: isForAllocation(allocationId),
			}),
		).toBe(2);
	},
	testTimeoutMs,
);

test(
	"a create whose reply never arrives makes one server, not two",
	async () => {
		const client = await createServerOwner(backend);
		let allocationId: string | undefined;
		const hasLostReply = fake.scriptOnce(
			{
				method: "POST",
				path: createdServers,
				body: (body) =>
					allocationId !== undefined && isForAllocation(allocationId)(body),
			},
			{ kind: "lose" },
		);
		const serverId = await createServer(client);
		allocationId = await requireAllocationId(serverId);

		const status = await settleServer(backend, client, serverId, {
			until: "running",
		});

		expect(hasLostReply()).toBe(true);
		expect(status.status).toBe("running");
		expect(
			fake.countRequests({
				method: "POST",
				path: createdServers,
				body: isForAllocation(allocationId),
			}),
		).toBe(1);
	},
	testTimeoutMs,
);

async function changePower(
	client: ServerClient,
	serverId: Id<"servers">,
	kind: "start" | "stop" | "forceStop",
	until: string,
) {
	const result = await client.mutation(api.servers.lifecycle.requestPower, {
		serverId,
		requestId: `request-${randomBytes(subjectSuffixBytes).toString("hex")}`,
		kind,
	});
	if (!result.ok) {
		throw new Error(`Asking to ${kind} failed: ${result.code}`);
	}
	return await settleServer(backend, client, serverId, { until });
}

test(
	"each power command is sent once, and a graceful stop never becomes a forced one",
	async () => {
		const client = await createServerOwner(backend);
		const serverId = await createServer(client);
		await settleServer(backend, client, serverId, { until: "running" });
		const hetznerServerId = await requireHetznerServerId(backend, serverId);
		const countAction = (action: string) =>
			fake.countRequests({
				method: "POST",
				path: new RegExp(`^/servers/${hetznerServerId}/actions/${action}$`),
			});

		expect(
			(await changePower(client, serverId, "stop", "stopped")).status,
		).toBe("stopped");
		expect(
			(await changePower(client, serverId, "start", "running")).status,
		).toBe("running");
		expect(
			(await changePower(client, serverId, "forceStop", "stopped")).status,
		).toBe("stopped");

		expect(countAction("shutdown")).toBe(1);
		expect(countAction("poweron")).toBe(1);
		expect(countAction("poweroff")).toBe(1);
	},
	testTimeoutMs,
);

test(
	"a delete finishes and leaves nothing, even when a reply never arrives",
	async () => {
		const client = await createServerOwner(backend);
		const serverId = await createServer(client);
		await settleServer(backend, client, serverId, { until: "running" });
		const record = await readServerBackendRecord(backend, serverId);
		const allocationId = record?.allocation._id;
		if (allocationId === undefined) {
			throw new Error("The server has no allocation.");
		}
		const deletedThisServer = {
			method: "DELETE",
			path: new RegExp(
				`^/servers/${await requireHetznerServerId(backend, serverId)}$`,
			),
		};
		const hasLostReply = fake.scriptOnce(deletedThisServer, { kind: "lose" });
		// A lost delete reply must not be retried against a possibly reused ID.

		await client.mutation(api.servers.lifecycle.requestDelete, { serverId });
		await settleServer(backend, client, serverId, { until: "gone" });

		expect(hasLostReply()).toBe(true);
		expect(await readOwnedResources(allocationId)).toEqual([]);
		expect(await readServerBackendRecord(backend, serverId)).toBe(null);
		expect(fake.countRequests(deletedThisServer)).toBe(1);
		await expect(
			backend.runAsAdmin(internal.allocations.operations.finishDelete, {
				allocationId,
			}),
		).resolves.toBe(null);
	},
	testTimeoutMs,
);

test(
	"recovery requires the current blocked operation and stuck timestamp",
	async () => {
		const client = await createServerOwner(backend);
		const serverId = await createServer(client);
		await settleServer(backend, client, serverId, { until: "running" });
		const record = await readServerBackendRecord(backend, serverId);
		if (record?.backend === null || record?.backend === undefined) {
			throw new Error("The server has no provider allocation.");
		}
		const { allocation, backend: provider } = record;
		await backend.runAsAdmin(
			internal.allocations.hetzner_cloud.worker_state.record,
			{
				allocationId: allocation._id,
				epoch: provider.epoch,
				operationId: allocation.operationId,
				queue: "work",
				update: {
					failure: { error: "test_block", class: "invalid", final: true },
				},
				usage: { requests: 0 },
			},
		);
		const blocked = await readServerBackendRecord(backend, serverId);
		const stuckSince = blocked?.allocation.stuck?.since;
		if (stuckSince === undefined) {
			throw new Error("The test failure did not block the operation.");
		}
		await expect(
			backend.runAsAdmin(
				internal.allocations.hetzner_cloud.worker_state.retry,
				{
					allocationId: allocation._id,
					recovery: {
						operationId: allocation.operationId,
						stuckSince: stuckSince + 1,
					},
				},
			),
		).rejects.toThrow();
		await expect(
			backend.runAsAdmin(
				internal.allocations.hetzner_cloud.worker_state.retry,
				{
					allocationId: allocation._id,
					recovery: {
						operationId: allocation.operationId,
						stuckSince,
					},
				},
			),
		).resolves.toBe(null);
		expect(
			(await readServerBackendRecord(backend, serverId))?.allocation.stuck,
		).toBe(undefined);
		await client.mutation(api.servers.lifecycle.requestDelete, { serverId });
		await settleServer(backend, client, serverId, { until: "gone" });
	},
	testTimeoutMs,
);

test(
	"a refusal that waits on something outside is asked again, not given up on",
	async () => {
		const client = await createServerOwner(backend);
		let allocationId: string | undefined;
		const hasRefused = fake.scriptOnce(
			{
				method: "POST",
				path: createdServers,
				body: (body) =>
					allocationId !== undefined && isForAllocation(allocationId)(body),
			},
			{
				kind: "reply",
				reply: {
					status: forbidden,
					body: {
						error: {
							code: "resource_limit_exceeded",
							message: "project limit exceeded",
						},
					},
				},
			},
		);
		const serverId = await createServer(client);
		allocationId = await requireAllocationId(serverId);

		const status = await settleServer(backend, client, serverId, {
			until: "running",
			timeoutMs: waitingTimeoutMs,
		});

		expect(hasRefused()).toBe(true);
		expect(status.status).toBe("running");
		expect(
			fake.countRequests({
				method: "POST",
				path: createdServers,
				body: isForAllocation(allocationId),
			}),
		).toBe(2);
	},
	waitingTestTimeoutMs,
);

async function settlePart(
	client: ServerClient,
	serverId: Id<"servers">,
	part: "firewall" | "server" | "addresses",
	until: string,
) {
	const deadline = Date.now() + partTimeoutMs;
	let seen = "";
	while (Date.now() < deadline) {
		const status = await readServerStatus(client, serverId);
		seen = status.parts[part];
		if (seen === until) {
			return status;
		}
		await Bun.sleep(partDelayMs);
	}
	throw new Error(`The ${part} stayed ${seen}.`);
}

test(
	"rules taken off a server stop nothing, and go back on by themselves",
	async () => {
		const client = await createServerOwner(backend);
		const serverId = await createServer(client);
		await settleServer(backend, client, serverId, { until: "running" });
		// The provider can detach the firewall without notifying Composery.
		await fake.detachFirewall(await requireHetznerServerId(backend, serverId));

		const stopped = await changePower(client, serverId, "stop", "stopped");
		expect(stopped.status).toBe("stopped");
		expect(stopped.parts.server).toBe("ok");

		const repaired = await settlePart(client, serverId, "firewall", "ok");
		expect(repaired.status).toBe("stopped");
	},
	testTimeoutMs,
);
