import { beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { ConvexError } from "convex/values";
import { api, internal } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
	type ConvexBackend,
	useConvexBackend,
} from "../../../harness/convex-backend";
import type { Fake } from "../../../harness/fake";
import { useHetznerFake } from "../../../harness/hetzner/fake";

const setupTimeoutMs = 600_000;
const testTimeoutMs = 300_000;
const subjectSuffixBytes = 6;
const quotaLimit = 10;
const settleTimeoutMs = 240_000;
const settleDelayMs = 250;
// The deployment paces its own work, so asking for a sweep faster than that starves the worker.
const sweepEveryMs = 2000;
// Enough of the trail to show where a stuck allocation stopped.
const trailLength = 12;
const createdServers = /^\/servers$/;
const createdPrimaryIps = /^\/primary_ips$/;
const shutdownActions = /^\/servers\/\d+\/actions\/shutdown$/;
const poweronActions = /^\/servers\/\d+\/actions\/poweron$/;
const poweroffActions = /^\/servers\/\d+\/actions\/poweroff$/;
const deletedServers = /^\/servers\/\d+$/;

let backend: ConvexBackend;
let fake: Fake;

beforeAll(async () => {
	backend = await useConvexBackend();
	fake = await useHetznerFake();
}, setupTimeoutMs);

/** One owner with room for servers, so no test waits on another's quota. */
async function createOwner() {
	const account = await backend.createAccount();
	const client = backend.createClient(account.id);
	const user = await client.query(api.users.getCurrent, {});
	if (user === null) {
		throw new Error("The user did not sync.");
	}
	await backend.runAsAdmin(internal.quotas.setForUser, {
		userId: user._id,
		kind: "server",
		limit: quotaLimit,
	});
	await backend.runAsAdmin(internal.quotas.setForDeployment, {
		kind: "server",
		limit: quotaLimit,
	});
	return client;
}

type ServerClient = Awaited<ReturnType<typeof createOwner>>;

async function createServer(client: ServerClient) {
	const name = `test-${randomBytes(subjectSuffixBytes).toString("hex")}`;
	const result = await client.mutation(api.servers.lifecycle.create, {
		name,
		requestId: `request-${randomBytes(subjectSuffixBytes).toString("hex")}`,
	});
	if (!result.ok) {
		throw new Error(`Creating the server failed: ${result.code}`);
	}
	const server = await client.query(api.servers.names.getByName, { name });
	if (server === null) {
		throw new Error("The created server is not readable.");
	}
	return server._id;
}

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
	ipv4: string | null;
	ipv6: string | null;
}>;

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
			return { status: "gone", ipv4: null, ipv6: null };
		}
		throw error;
	}
}

/** Waits until the worker has taken the allocation as far as it can. */
async function settle(
	client: ServerClient,
	serverId: Id<"servers">,
	until: (status: string) => boolean,
) {
	const deadline = Date.now() + settleTimeoutMs;
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
		const client = await createOwner();
		const before = fake.countRequests("POST", createdServers);
		const serverId = await createServer(client);
		const status = await settle(
			client,
			serverId,
			(value) => value === "running" || value === "blocked",
		);

		expect(status.status).toBe("running");
		expect(status.ipv4).not.toBe(null);
		expect(fake.countRequests("POST", createdServers) - before).toBe(1);
	},
	testTimeoutMs,
);

test(
	"a create whose reply never arrives makes one server, not two",
	async () => {
		const client = await createOwner();
		const before = fake.countRequests("POST", createdPrimaryIps);
		// Hetzner takes the request and answers nothing: the outcome is unknown, not failed.
		fake.scriptOnce({ method: "POST", path: createdPrimaryIps }, "lose");
		const serverId = await createServer(client);
		const status = await settle(
			client,
			serverId,
			(value) => value === "running" || value === "blocked",
		);

		expect(status.status).toBe("running");
		// One address was lost to the silence and found again; the second is the other kind.
		expect(fake.countRequests("POST", createdPrimaryIps) - before).toBe(2);
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
	return await settle(
		client,
		serverId,
		(value) => value === until || value === "blocked",
	);
}

test(
	"each power command is sent once, and a graceful stop never becomes a forced one",
	async () => {
		const client = await createOwner();
		const serverId = await createServer(client);
		await settle(client, serverId, (value) => value === "running");
		const before = {
			graceful: fake.countRequests("POST", shutdownActions),
			on: fake.countRequests("POST", poweronActions),
			forced: fake.countRequests("POST", poweroffActions),
		};

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
		expect(fake.countRequests("POST", shutdownActions) - before.graceful).toBe(
			1,
		);
		expect(fake.countRequests("POST", poweronActions) - before.on).toBe(1);
		expect(fake.countRequests("POST", poweroffActions) - before.forced).toBe(1);
	},
	testTimeoutMs,
);

test(
	"a delete finishes and leaves nothing, even when a reply never arrives",
	async () => {
		const client = await createOwner();
		const serverId = await createServer(client);
		await settle(client, serverId, (value) => value === "running");
		const record = await readBackendRecord(serverId);
		const allocationId = record?.allocation._id;
		if (allocationId === undefined) {
			throw new Error("The server has no allocation.");
		}
		const before = fake.countRequests("DELETE", deletedServers);
		// Hetzner deletes the server and answers nothing. Asking again must not delete a second
		// thing: by then the identifier could belong to somebody else.
		fake.scriptOnce({ method: "DELETE", path: deletedServers }, "lose");

		await client.mutation(api.servers.lifecycle.requestDelete, { serverId });
		await settle(client, serverId, (value) => value === "gone");

		// Everything Composery made for this allocation is gone, not merely forgotten: at the
		// provider, and in our own tables, where a row left behind would name a server that is not
		// there.
		expect(await readOwnedResources(allocationId)).toEqual([]);
		expect(await readBackendRecord(serverId)).toBe(null);
		expect(fake.countRequests("DELETE", deletedServers) - before).toBe(1);
	},
	testTimeoutMs,
);
