import { type Infer, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
	internalQuery,
	type MutationCtx,
	type QueryCtx,
} from "../_generated/server";
import { type Failure, fail, toConvexError } from "../errors";
import { internalMutation } from "../functions";
import schema from "../schema";
import {
	deleteAllocationSshAccess,
	isSshAccessConfigured,
} from "../ssh/access_state";
import { selectReportedAddress } from "./addresses";
import {
	getHetznerCloudConfig,
	type HetznerCloudConfig,
} from "./hetzner_cloud/api";
import {
	checkHetznerCloudPower,
	createHetznerCloudAllocation,
	deleteHetznerCloudAllocation,
	getHetznerCloudAllocation,
	hetznerCloudPowerDeadlineMs,
	wakeHetznerCloudAllocation,
} from "./hetzner_cloud/worker_state";
import type { powerOperationKind } from "./schema";
import { isAllocationDeleting } from "./schema";

const requestIdPattern = /^[a-zA-Z0-9_-]{8,100}$/;
const operationsPerPass = 100;

export type AllocationConfig = HetznerCloudConfig;

export function requireRequestId(requestId: string) {
	if (!requestIdPattern.test(requestId)) {
		throw toConvexError("request_id_invalid");
	}
}

export async function deleteServerAllocation(
	ctx: MutationCtx,
	allocationId: Id<"serverAllocations">,
) {
	const allocation = await ctx.db.get("serverAllocations", allocationId);
	if (allocation === null) {
		return;
	}
	const provider = await getHetznerCloudAllocation(ctx, allocationId);
	if (
		!isAllocationDeleting(allocation) ||
		provider === null ||
		Object.values(provider.resources).some(({ status }) => status !== "absent")
	) {
		throw new Error(
			"An allocation can finish deletion only after all resources are absent.",
		);
	}
	await deleteAllocationSshAccess(ctx, allocationId);
	await deleteHetznerCloudAllocation(ctx, allocationId);
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
		// Every server is created with an allocation and deleted with it.
		throw toConvexError("server_broken");
	}
	return allocation;
}

export async function requireChangeableServerAllocation(
	ctx: QueryCtx,
	serverId: Id<"servers">,
) {
	const allocation = await requireServerAllocation(ctx, serverId);
	if (isAllocationDeleting(allocation)) {
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

export function getAllocationConfig(): AllocationConfig | null {
	// Existing allocations keep their stored configuration; this only starts new ones.
	if (!isSshAccessConfigured()) {
		return null;
	}
	const hetznerCloud = getHetznerCloudConfig();
	return hetznerCloud;
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
		status: "creating",
		parts: { server: "unknown", addresses: "unknown", firewall: "unknown" },
	});
	await createHetznerCloudAllocation(ctx, allocationId, request.config);
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
	if (isAllocationDeleting(allocation)) {
		throw new Error(
			"An allocation that is being deleted accepts no power operation.",
		);
	}
	const current = await ctx.db.get("serverOperations", allocation.operationId);
	if (current?.status === "pending") {
		return fail("server_busy");
	}
	const backendFailure = await checkHetznerCloudPower(ctx, allocation._id);
	if (backendFailure !== null) {
		return backendFailure;
	}
	const operationId = await ctx.db.insert("serverOperations", {
		serverId: allocation.serverId,
		requesterId: request.requesterId,
		requestId: request.requestId,
		kind: request.kind,
		status: "pending",
		deadlineAt: Date.now() + hetznerCloudPowerDeadlineMs,
	});
	await ctx.db.patch("serverAllocations", allocation._id, { operationId });
	await wakeHetznerCloudAllocation(ctx, allocation._id);
	return { ok: true, operationId };
}

export async function requestAllocationDelete(
	ctx: MutationCtx,
	allocation: Doc<"serverAllocations">,
	requesterId?: Id<"users">,
) {
	if (isAllocationDeleting(allocation)) {
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
		status: "deleting",
	});
	// The wake reads the allocation again, so it sees the deletion already recorded.
	await wakeHetznerCloudAllocation(ctx, allocation._id);
}

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

export const recordReportedAddress = internalMutation({
	args: {
		allocationId: v.id("serverAllocations"),
		addresses: v.array(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, { allocationId, addresses }) => {
		const allocation = await ctx.db.get("serverAllocations", allocationId);
		if (allocation !== null) {
			const address = selectReportedAddress(allocation.ipv6, addresses);
			if (address !== null && address !== allocation.ipv6Address) {
				await ctx.db.patch("serverAllocations", allocation._id, {
					ipv6Address: address,
				});
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

export async function removeServerOperations(
	ctx: MutationCtx,
	serverId: Id<"servers">,
) {
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
}

export const removeOperations = internalMutation({
	args: { serverId: v.id("servers") },
	returns: v.null(),
	handler: async (ctx, { serverId }) => {
		await removeServerOperations(ctx, serverId);
		return null;
	},
});
