import { beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { ConvexError } from "convex/values";
import { api, internal } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
	type ConvexBackend,
	useConvexBackend,
} from "../../../harness/convex/backend";
import {
	type HetznerFake,
	useHetznerFake,
} from "../../../harness/hetzner/fake";
import { createServer, createServerOwner } from "../../../harness/servers";

const setupTimeoutMs = 600_000;
const testTimeoutMs = 300_000;
const subjectSuffixBytes = 6;
const settleTimeoutMs = 240_000;
const settleDelayMs = 250;
// A refusal that waits on something outside comes back after a minute, and then has to finish.
const waitingTimeoutMs = 420_000;
const waitingTestTimeoutMs = 600_000;
const forbidden = 403;
// The deployment paces its own work, so asking for a sweep faster than that starves the worker.
const sweepEveryMs = 2000;
// Enough of the trail to show where a stuck allocation stopped.
const trailLength = 12;
const createdServers = /^\/servers$/;
const createdPrimaryIps = /^\/primary_ips$/;

let backend: ConvexBackend;
let fake: HetznerFake;

beforeAll(async () => {
	backend = await useConvexBackend();
	fake = await useHetznerFake();
}, setupTimeoutMs);

type ServerClient = Awaited<ReturnType<typeof createServerOwner>>;

/** What the backend recorded, which is where a stuck allocation says why it stopped. */
async function readBackendRecord(serverId: Id<"servers">) {
	const allocation = await backend.runAsAdmin(
		internal.allocations.operations.getForServer,
		{ serverId },
	);
	if (allocation === null) {
		return null;
	}
	return {
		allocation,
		backend: await backend.runAsAdmin(
			internal.allocations.hetzner_cloud.worker_state.get,
			{ allocationId: allocation._id },
		),
	};
}

/** The allocation a server is running on, which every request the worker sends for it names. */
async function requireAllocationId(serverId: Id<"servers">) {
	const allocationId = (await readBackendRecord(serverId))?.allocation._id;
	if (allocationId === undefined) {
		throw new Error("The server has no allocation.");
	}
	return allocationId;
}

/** Hetzner's number for a server, which a request about that server carries in its path. */
async function requireHetznerServerId(serverId: Id<"servers">) {
	const server = (await readBackendRecord(serverId))?.backend?.resources.server;
	if (server?.status !== "present") {
		throw new Error("The server does not exist at Hetzner yet.");
	}
	return server.id;
}

/** Whether a create request is for this allocation, by the label Composery puts on everything. */
function isForAllocation(allocationId: string) {
	return (body: unknown) =>
		(body as { labels?: Record<string, string> } | undefined)?.labels?.[
			"allocation-id"
		] === allocationId;
}

/** What the fake still holds for one allocation, which is what "deleted" has to mean. */
async function readOwnedResources(allocationId: string) {
	const reply = await fetch(
		`${fake.url}/v1/servers?label_selector=allocation-id=${allocationId}`,
	);
	const servers = ((await reply.json()) as { servers: unknown[] }).servers;
	const addressReply = await fetch(
		`${fake.url}/v1/primary_ips?label_selector=allocation-id=${allocationId}`,
	);
	// biome-ignore lint/style/useNamingConvention: the Hetzner Cloud API names this collection
	const addresses = ((await addressReply.json()) as { primary_ips: unknown[] })
		.primary_ips;
	return [...servers, ...addresses];
}

type ServerStatus = Readonly<{
	status: string;
	parts: {
		server: string;
		addresses: string;
		firewall: string;
		managementAccess: string;
	};
	ipv4: string | null;
	ipv6: string | null;
}>;

const goneParts = {
	server: "missing",
	addresses: "missing",
	firewall: "missing",
	managementAccess: "missing",
} as const;

/** What the panel shows for a server, or `gone` once deletion has removed it. */
async function readStatus(
	client: ServerClient,
	serverId: Id<"servers">,
): Promise<ServerStatus> {
	try {
		return await client.query(api.servers.lifecycle.getStatus, { serverId });
	} catch (error) {
		if (
			error instanceof ConvexError &&
			(error.data as { code?: string }).code === "server_not_found"
		) {
			return { status: "gone", parts: goneParts, ipv4: null, ipv6: null };
		}
		throw error;
	}
}

/** Waits until the worker has taken the allocation as far as it can. */
async function settle(
	client: ServerClient,
	serverId: Id<"servers">,
	until: (status: string) => boolean,
	timeoutMs = settleTimeoutMs,
) {
	const deadline = Date.now() + timeoutMs;
	let status = "creating";
	let sweptAt = 0;
	while (Date.now() < deadline) {
		// A delete that finishes takes the server with it, so there is no status left to read.
		// That absence is the outcome, and it is reported as one rather than as an error.
		const state = await readStatus(client, serverId);
		status = state.status;
		if (until(status)) {
			return state;
		}
		// The deployment's own sweep runs every ten seconds; a test asks for it sooner.
		if (Date.now() - sweptAt > sweepEveryMs) {
			sweptAt = Date.now();
			await backend.runAsAdmin(
				internal.allocations.hetzner_cloud.worker_state.sweep,
				{},
			);
		}
		await Bun.sleep(settleDelayMs);
	}
	const trail = fake
		.requests()
		.slice(-trailLength)
		.map((request) => `${request.method} ${request.path}`);
	throw new Error(
		`The allocation stayed ${status}: ${JSON.stringify(await readBackendRecord(serverId))} :: ${trail.join(" ;; ")}`,
	);
}

test(
	"a created server reaches running, with one server and two addresses at the provider",
	async () => {
		const client = await createServerOwner(backend);
		const serverId = await createServer(client);
		const status = await settle(
			client,
			serverId,
			(value) => value === "running",
		);
		const allocationId = await requireAllocationId(serverId);

		expect(status.status).toBe("running");
		expect(status.ipv4).not.toBe(null);
		expect(
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
		// The server is asked for only after both of its addresses exist, so this test learns its own
		// allocation well before that request can be sent, and loses only that one reply.
		let allocationId: string | undefined;
		const hasLostReply = fake.scriptOnce(
			{
				method: "POST",
				path: createdServers,
				body: (body) =>
					allocationId !== undefined && isForAllocation(allocationId)(body),
			},
			"lose",
		);
		const serverId = await createServer(client);
		allocationId = await requireAllocationId(serverId);

		const status = await settle(
			client,
			serverId,
			(value) => value === "running",
		);

		// Hetzner made the server and the answer never came. Composery found it again instead of
		// asking twice, which would have made a second server nobody can see.
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

/** Asks for a power change and waits for the worker to carry it out. */
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
	return await settle(client, serverId, (value) => value === until);
}

test(
	"each power command is sent once, and a graceful stop never becomes a forced one",
	async () => {
		const client = await createServerOwner(backend);
		const serverId = await createServer(client);
		await settle(client, serverId, (value) => value === "running");
		const hetznerServerId = await requireHetznerServerId(serverId);
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

		// Three commands, three different Hetzner actions, none of them repeated.
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
		await settle(client, serverId, (value) => value === "running");
		const record = await readBackendRecord(serverId);
		const allocationId = record?.allocation._id;
		if (allocationId === undefined) {
			throw new Error("The server has no allocation.");
		}
		const deletedThisServer = {
			method: "DELETE",
			path: new RegExp(`^/servers/${await requireHetznerServerId(serverId)}$`),
		};
		// Hetzner deletes the server and answers nothing. Asking again must not delete a second
		// thing: by then the identifier could belong to somebody else.
		const hasLostReply = fake.scriptOnce(deletedThisServer, "lose");

		await client.mutation(api.servers.lifecycle.requestDelete, { serverId });
		await settle(client, serverId, (value) => value === "gone");

		// Everything Composery made for this allocation is gone, not merely forgotten: at the
		// provider, and in our own tables, where a row left behind would name a server that is not
		// there.
		expect(hasLostReply()).toBe(true);
		expect(await readOwnedResources(allocationId)).toEqual([]);
		expect(await readBackendRecord(serverId)).toBe(null);
		expect(fake.countRequests(deletedThisServer)).toBe(1);
	},
	testTimeoutMs,
);

test(
	"a refusal that waits on something outside is asked again, not given up on",
	async () => {
		const client = await createServerOwner(backend);
		// The project is at its limit. Nothing about the request is wrong, and nobody here can fix
		// it: an admin raises the limit, and until then the only right move is to ask again later.
		let allocationId: string | undefined;
		const hasRefused = fake.scriptOnce(
			{
				method: "POST",
				path: createdServers,
				body: (body) =>
					allocationId !== undefined && isForAllocation(allocationId)(body),
			},
			{
				status: forbidden,
				body: {
					error: {
						code: "resource_limit_exceeded",
						message: "project limit exceeded",
					},
				},
			},
		);
		const serverId = await createServer(client);
		allocationId = await requireAllocationId(serverId);

		const status = await settle(
			client,
			serverId,
			(value) => value === "running",
			waitingTimeoutMs,
		);

		// The allocation says it is stuck while it waits, and then it finishes by itself.
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

test(
	"rules taken off a server do not stop a power command, and are reported",
	async () => {
		const client = await createServerOwner(backend);
		const serverId = await createServer(client);
		await settle(client, serverId, (value) => value === "running");
		// An admin can take the project's rules off a server in Hetzner's own console. The server
		// keeps running, and stopping it has nothing to do with what protects it.
		fake.detachFirewall(await requireHetznerServerId(serverId));

		const stopped = await changePower(client, serverId, "stop", "stopped");

		expect(stopped.status).toBe("stopped");
		expect(stopped.parts.firewall).toBe("missing");
		expect(stopped.parts.server).toBe("ok");
	},
	testTimeoutMs,
);
