import type { FunctionReference } from "convex/server";
import { type Infer, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	type MutationCtx,
	type QueryCtx,
} from "../_generated/server";
import { type Failure, fail, toConvexError } from "../errors";
import schema from "../schema";
import {
	deleteAllocationSshAccess,
	isSshAccessConfigured,
} from "../ssh/access_state";
import { toReportedAddress } from "./addresses";
import {
	getHetznerCloudConfig,
	type HetznerCloudConfig,
} from "./hetzner_cloud/api";
import {
	checkHetznerCloudPower,
	createHetznerCloudAllocation,
	hetznerCloudPowerDeadlineMs,
	wakeHetznerCloudAllocation,
} from "./hetzner_cloud/worker_state";
import type { allocationBackend, powerOperationKind } from "./schema";

const requestIdPattern = /^[a-zA-Z0-9_-]{8,100}$/;
// A server asks for few operations, so one pass almost always finishes.
const operationsPerPass = 100;

type AllocationBackend = Infer<typeof allocationBackend>;

export type AllocationConfig = {
	backend: "hetznerCloud";
	hetznerCloud: HetznerCloudConfig;
};

export function requireRequestId(requestId: string) {
	if (!requestIdPattern.test(requestId)) {
		throw toConvexError("request_id_invalid");
	}
}

/** Every server has exactly one allocation from creation until the server is deleted. */
/** Removes the allocation itself, in the same change that removes the server it ran. */
export async function deleteServerAllocation(
	ctx: MutationCtx,
	allocationId: Id<"serverAllocations">,
) {
	await ctx.db.delete("serverAllocations", allocationId);
}

export async function requireServerAllocation(
	ctx: QueryCtx,
	serverId: Id<"servers">,
) {
	const allocation = await ctx.db
		.query("serverAllocations")
		.withIndex("by_server_id", (q) => q.eq("serverId", serverId))
		.unique();
	if (allocation === null) {
		// Every server is made with one, and they are deleted together, so this is a defect rather
		// than a state. A caller still gets a code it can tell apart from every other refusal.
		throw toConvexError("server_broken");
	}
	return allocation;
}

/** The allocation of a server that can still change: one whose deletion nobody requested. */
export async function requireChangeableServerAllocation(
	ctx: QueryCtx,
	serverId: Id<"servers">,
) {
	const allocation = await requireServerAllocation(ctx, serverId);
	if (allocation.deleteRequested) {
		throw toConvexError("server_deleting");
	}
	return allocation;
}

export async function getOperationByRequest(
	ctx: QueryCtx,
	requesterId: Id<"users">,
	requestId: string,
) {
	return await ctx.db
		.query("serverOperations")
		.withIndex("by_requester_id_and_request_id", (q) =>
			q.eq("requesterId", requesterId).eq("requestId", requestId),
		)
		.unique();
}

/** Returns null when creation is not configured. An existing allocation keeps the configuration that it was created with. */
export function getAllocationConfig(): AllocationConfig | null {
	if (!isSshAccessConfigured()) {
		return null;
	}
	const hetznerCloud = getHetznerCloudConfig();
	return hetznerCloud === null
		? null
		: { backend: "hetznerCloud", hetznerCloud };
}

function getPowerDeadlineMs(backend: AllocationBackend) {
	switch (backend) {
		case "hetznerCloud":
			return hetznerCloudPowerDeadlineMs;
	}
}

export async function requestAllocationCreate(
	ctx: MutationCtx,
	request: {
		serverId: Id<"servers">;
		requesterId: Id<"users">;
		requestId: string;
		name: string;
		config: AllocationConfig;
	},
) {
	const operationId = await ctx.db.insert("serverOperations", {
		serverId: request.serverId,
		requesterId: request.requesterId,
		requestId: request.requestId,
		name: request.name,
		kind: "create",
		status: "pending",
	});
	const allocationId = await ctx.db.insert("serverAllocations", {
		serverId: request.serverId,
		operationId,
		backend: request.config.backend,
		status: "creating",
		// Nothing has been seen yet, which is not the same as anything being wrong.
		parts: { server: "unknown", addresses: "unknown", firewall: "unknown" },
		deleteRequested: false,
	});
	switch (request.config.backend) {
		case "hetznerCloud":
			await createHetznerCloudAllocation(
				ctx,
				allocationId,
				request.config.hetznerCloud,
			);
			return;
	}
}

export async function requestAllocationPower(
	ctx: MutationCtx,
	allocation: Doc<"serverAllocations">,
	request: {
		requesterId: Id<"users">;
		requestId: string;
		kind: Infer<typeof powerOperationKind>;
	},
): Promise<Failure | { ok: true; operationId: Id<"serverOperations"> }> {
	if (allocation.deleteRequested) {
		throw new Error(
			"An allocation that is being deleted accepts no power operation.",
		);
	}
	const current = await ctx.db.get("serverOperations", allocation.operationId);
	if (current?.status === "pending") {
		return fail("server_busy");
	}
	const backendFailure = await checkBackendPower(ctx, allocation);
	if (backendFailure !== null) {
		return backendFailure;
	}
	const operationId = await ctx.db.insert("serverOperations", {
		serverId: allocation.serverId,
		requesterId: request.requesterId,
		requestId: request.requestId,
		kind: request.kind,
		status: "pending",
		deadlineAt: Date.now() + getPowerDeadlineMs(allocation.backend),
	});
	await ctx.db.patch("serverAllocations", allocation._id, { operationId });
	await wakeBackend(ctx, allocation);
	return { ok: true, operationId };
}

async function checkBackendPower(
	ctx: MutationCtx,
	allocation: Doc<"serverAllocations">,
) {
	switch (allocation.backend) {
		case "hetznerCloud":
			return await checkHetznerCloudPower(ctx, allocation._id);
	}
}

async function wakeBackend(
	ctx: MutationCtx,
	allocation: Doc<"serverAllocations">,
) {
	switch (allocation.backend) {
		case "hetznerCloud":
			await wakeHetznerCloudAllocation(ctx, allocation._id);
			return;
	}
}

/** The backend deletes the infrastructure and then calls `finishDelete`. */
export async function requestAllocationDelete(
	ctx: MutationCtx,
	allocation: Doc<"serverAllocations">,
	requesterId?: Id<"users">,
) {
	if (allocation.deleteRequested) {
		return;
	}
	const current = await ctx.db.get("serverOperations", allocation.operationId);
	if (current !== null && current.status !== "succeeded") {
		await ctx.db.patch("serverOperations", current._id, {
			status: "superseded",
			finishedAt: Date.now(),
		});
	}
	const operationId = await ctx.db.insert("serverOperations", {
		serverId: allocation.serverId,
		...(requesterId === undefined ? {} : { requesterId }),
		requestId: `delete_${allocation._id}`,
		kind: "delete",
		status: "pending",
	});
	await ctx.db.patch("serverAllocations", allocation._id, {
		operationId,
		deleteRequested: true,
		status: "deleting",
	});
	await wakeBackend(ctx, { ...allocation, deleteRequested: true });
}

/** One allocation, for work that already knows which one it is about. */
export const get = internalQuery({
	args: { allocationId: v.id("serverAllocations") },
	returns: v.union(schema.doc("serverAllocations"), v.null()),
	handler: async (ctx, { allocationId }) =>
		await ctx.db.get("serverAllocations", allocationId),
});

export const getForServer = internalQuery({
	args: { serverId: v.id("servers") },
	returns: v.union(schema.doc("serverAllocations"), v.null()),
	handler: async (ctx, { serverId }) =>
		await ctx.db
			.query("serverAllocations")
			.withIndex("by_server_id", (q) => q.eq("serverId", serverId))
			.unique(),
});

/**
 * Writes down an address a server has been seen answering on, when it is one of its own. A
 * provider states an IPv6 assignment as a range and the server chooses inside it, so the only
 * addresses that count are the ones the server has used: the one it reached us from when it
 * reported its host key, and the ones it lists for itself when asked.
 */
export async function storeReportedAddress(
	ctx: MutationCtx,
	allocation: Doc<"serverAllocations">,
	reported: string | undefined,
) {
	const address = toReportedAddress(allocation.ipv6, reported);
	if (address !== null && address !== allocation.ipv6Address) {
		await ctx.db.patch("serverAllocations", allocation._id, {
			ipv6Address: address,
		});
	}
}

export const recordReportedAddress = internalMutation({
	args: {
		allocationId: v.id("serverAllocations"),
		addresses: v.array(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, { allocationId, addresses }) => {
		const allocation = await ctx.db.get("serverAllocations", allocationId);
		if (allocation !== null) {
			for (const address of addresses) {
				await storeReportedAddress(ctx, allocation, address);
			}
		}
		return null;
	},
});

export const storeHostname = internalMutation({
	args: { allocationId: v.id("serverAllocations"), hostname: v.string() },
	returns: v.null(),
	handler: async (ctx, { allocationId, hostname }) => {
		await ctx.db.patch("serverAllocations", allocationId, { hostname });
		return null;
	},
});

/**
 * What each backend removes once its allocation is gone. A backend owns its own table, so it does
 * its own forgetting, and a new backend fails to compile until it says how.
 */
const forgetAllocation: Record<
	AllocationBackend,
	FunctionReference<
		"mutation",
		"internal",
		{ allocationId: Id<"serverAllocations"> }
	>
> = {
	hetznerCloud: internal.allocations.hetzner_cloud.worker_state.forget,
};

/**
 * The last step of a deletion: nothing that described the allocation outlives the server it ran.
 *
 * This keeps no history on purpose. Every way of reading an allocation starts from its server, so
 * a row left behind could never be read again, and it would hold an identifier that resolves to
 * nothing. A record that outlives a server is a different thing with a shape of its own, and it
 * will be built when something needs it.
 */
export const finishDelete = internalMutation({
	args: { allocationId: v.id("serverAllocations") },
	returns: v.null(),
	handler: async (ctx, { allocationId }) => {
		const allocation = await ctx.db.get("serverAllocations", allocationId);
		if (allocation === null || allocation.status !== "deleted") {
			throw new Error("An allocation must be deleted before it is finished.");
		}
		await deleteAllocationSshAccess(ctx, allocationId);
		await ctx.scheduler.runAfter(0, forgetAllocation[allocation.backend], {
			allocationId,
		});
		// The server and its allocation go together, and what described their work goes after them:
		// until they are gone, a status read must still find the operation the allocation names.
		await ctx.scheduler.runAfter(0, internal.servers.lifecycle.finishDelete, {
			allocationId,
		});
		return null;
	},
});

/**
 * Removes what one server asked for, once the server itself is gone. A page at a time, because one
 * server can have asked for many, and nothing reads these rows any more.
 */
export const removeOperations = internalMutation({
	args: { serverId: v.id("servers") },
	returns: v.null(),
	handler: async (ctx, { serverId }) => {
		const operations = await ctx.db
			.query("serverOperations")
			.withIndex("by_server_id", (q) => q.eq("serverId", serverId))
			.take(operationsPerPass);
		for (const operation of operations) {
			await ctx.db.delete("serverOperations", operation._id);
		}
		if (operations.length === operationsPerPass) {
			await ctx.scheduler.runAfter(
				0,
				internal.allocations.operations.removeOperations,
				{ serverId },
			);
		}
		return null;
	},
});
