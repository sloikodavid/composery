import { randomBytes } from "node:crypto";
import type { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { ConvexBackend } from "./convex/backend";

const suffixBytes = 6;
/** Room enough that no test waits on another test's servers. */
const quotaLimit = 10;
const settleTimeoutMs = 240_000;
const settleDelayMs = 250;
// The deployment paces its own work, so asking for a sweep faster than that starves the worker.
const sweepEveryMs = 2000;

/** A signed-in account with room for servers, at its own level and at the deployment's. */
export async function createServerOwner(backend: ConvexBackend) {
	const account = await backend.createAccount();
	const client = backend.createClient(account.id);
	const user = await client.query(api.users.getCurrent, {});
	if (user === null) {
		throw new Error("The owner did not sync.");
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

/** Asks for a server under a name no other test uses, and returns it once it can be read. */
export async function createServer(client: ConvexHttpClient) {
	const name = `test-${randomBytes(suffixBytes).toString("hex")}`;
	const created = await client.mutation(api.servers.lifecycle.create, {
		name,
		requestId: `request-${randomBytes(suffixBytes).toString("hex")}`,
	});
	if (!created.ok) {
		throw new Error(`Creating the server failed: ${created.code}`);
	}
	const server = await client.query(api.servers.names.getByName, { name });
	if (server === null) {
		throw new Error("The created server is not readable.");
	}
	return server._id;
}

export type ServerClient = Awaited<ReturnType<typeof createServerOwner>>;

/** What the backend recorded, which is where a stuck allocation says why it stopped. */
export async function readServerBackendRecord(
	backend: ConvexBackend,
	serverId: Id<"servers">,
) {
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

/** Hetzner's number for a server, which a request about that server carries in its path. */
export async function requireHetznerServerId(
	backend: ConvexBackend,
	serverId: Id<"servers">,
) {
	const server = (await readServerBackendRecord(backend, serverId))?.backend
		?.resources.server;
	if (server?.status !== "present") {
		throw new Error("The server does not exist at Hetzner yet.");
	}
	return server.id;
}

export type ServerStatus = Readonly<{
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
export async function readServerStatus(
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

/**
 * Waits until the worker has taken the allocation as far as it can, asking for the sweep that the
 * deployment's own cron runs, so that a test waits for the work rather than for the clock.
 */
export async function settleServer(
	backend: ConvexBackend,
	client: ServerClient,
	serverId: Id<"servers">,
	{ until, timeoutMs = settleTimeoutMs }: { until: string; timeoutMs?: number },
) {
	const deadline = Date.now() + timeoutMs;
	let status = "creating";
	let sweptAt = 0;
	while (Date.now() < deadline) {
		// A delete that finishes takes the server with it, so there is no status left to read.
		// That absence is the outcome, and it is reported as one rather than as an error.
		const state = await readServerStatus(client, serverId);
		status = state.status;
		if (status === until) {
			return state;
		}
		if (Date.now() - sweptAt > sweepEveryMs) {
			sweptAt = Date.now();
			await backend.runAsAdmin(
				internal.allocations.hetzner_cloud.worker_state.sweep,
				{},
			);
		}
		await Bun.sleep(settleDelayMs);
	}
	throw new Error(
		`The allocation stayed ${status}: ${JSON.stringify(await readServerBackendRecord(backend, serverId))}`,
	);
}
