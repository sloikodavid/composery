import { randomBytes } from "node:crypto";
import type { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { ConvexBackend } from "./convex/backend";

const suffixBytes = 6;
const userQuotaLimit = 10;
// The test deployment has no aggregate cap; quota tests set one explicitly.
const deploymentQuotaLimit = Number.MAX_SAFE_INTEGER;
const settleTimeoutMs = 240_000;
const settleDelayMs = 250;
// Faster sweeps would compete with the worker's own pacing.
const sweepEveryMs = 2000;

async function removeTestServer(
	backend: ConvexBackend,
	serverId: Id<"servers">,
) {
	const allocation = await backend.runAsAdmin(
		internal.allocations.operations.getForServer,
		{ serverId },
	);
	if (allocation === null) {
		return;
	}
	try {
		await backend.runAsAdmin(
			internal.servers.ownership.requestDeleteForServer,
			{ serverId },
		);
	} catch (error) {
		try {
			const remaining = await backend.runAsAdmin(
				internal.allocations.operations.getForServer,
				{ serverId },
			);
			if (remaining === null) {
				return;
			}
		} catch (checkError) {
			throw new AggregateError(
				[error, checkError],
				`The test server ${serverId} cleanup could not be verified.`,
			);
		}
		throw error;
	}
	await settleTestServer(backend, serverId);
}

async function settleTestServer(
	backend: ConvexBackend,
	serverId: Id<"servers">,
) {
	const deadline = Date.now() + settleTimeoutMs;
	let sweptAt = 0;
	while (Date.now() < deadline) {
		const allocation = await backend.runAsAdmin(
			internal.allocations.operations.getForServer,
			{ serverId },
		);
		if (allocation === null) {
			return;
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
	throw new Error(`The test server ${serverId} was not removed in time.`);
}

export async function createServerOwner(backend: ConvexBackend) {
	const account = await backend.createAccount();
	const client = backend.createClient(account.id);
	const user = await client.query(api.users.getCurrent, {});
	if (user === null) {
		throw new Error("The owner did not sync.");
	}
	await backend.runAsAdmin(internal.servers.quotas.set, {
		userId: user._id,
		limit: userQuotaLimit,
	});
	await backend.runAsAdmin(internal.servers.quotas.set, {
		limit: deploymentQuotaLimit,
	});
	return client;
}

export async function createServer(client: ConvexHttpClient) {
	const created = await client.mutation(api.servers.lifecycle.create, {
		name: `test-${randomBytes(suffixBytes).toString("hex")}`,
		requestId: `request-${randomBytes(suffixBytes).toString("hex")}`,
	});
	if (!created.ok) {
		throw new Error(`Creating the server failed: ${created.code}`);
	}
	return created.serverId;
}

export async function cleanupTestServer(
	backend: ConvexBackend,
	serverId: Id<"servers">,
) {
	await removeTestServer(backend, serverId);
}

export type ServerClient = Awaited<ReturnType<typeof createServerOwner>>;

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
