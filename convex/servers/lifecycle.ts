import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	query,
} from "../_generated/server";
import {
	deleteServerAllocation,
	getAllocationConfig,
	getOperationByRequest,
	requestAllocationCreate,
	requestAllocationDelete,
	requestAllocationPower,
	requireChangeableServerAllocation,
	requireRequestId,
	requireServerAllocation,
} from "../allocations/operations";
import {
	allocationPartState,
	allocationParts,
	allocationStatus,
	operationKind,
	operationStatus,
	powerOperationKind,
} from "../allocations/schema";
import { fail, failure } from "../errors";
import { releaseServerQuota, reserveServerQuota } from "../quotas";
import { requireRateLimit } from "../rate_limits";
import { getAllocationSshAccess } from "../ssh/access_state";
import { requireUser } from "../users";
import { checkServerNameClaim, claimServerName } from "./names";
import { requireServerAccess } from "./permissions";

export async function requestServerDelete(
	ctx: MutationCtx,
	serverId: Id<"servers">,
	requesterId?: Id<"users">,
) {
	await requestAllocationDelete(
		ctx,
		await requireServerAllocation(ctx, serverId),
		requesterId,
	);
}

export const create = mutation({
	args: { name: v.string(), requestId: v.string() },
	returns: v.union(
		v.object({ ok: v.literal(true), name: v.string() }),
		failure,
	),
	handler: async (ctx, { name, requestId }) => {
		const user = await requireUser(ctx);
		requireRequestId(requestId);
		const previous = await getOperationByRequest(ctx, user._id, requestId);
		if (previous !== null) {
			if (previous.kind !== "create" || previous.name !== name) {
				return fail("request_id_conflict");
			}
			const server = await ctx.db.get("servers", previous.serverId);
			return server === null
				? fail("server_deleted")
				: { ok: true as const, name: server.name };
		}
		const claimFailure = await checkServerNameClaim(ctx, user._id, name);
		if (claimFailure !== null) {
			return claimFailure;
		}
		const config = getAllocationConfig();
		if (config === null) {
			return fail("server_capacity_unavailable");
		}
		const quotaFailure = await reserveServerQuota(ctx, user._id);
		if (quotaFailure !== null) {
			return quotaFailure;
		}
		const serverId = await ctx.db.insert("servers", {
			name,
			ownerId: user._id,
		});
		await claimServerName(ctx, name, serverId);
		await requestAllocationCreate(ctx, {
			serverId,
			requesterId: user._id,
			requestId,
			name,
			config,
		});
		return { ok: true as const, name };
	},
});

export const requestPower = mutation({
	args: {
		serverId: v.id("servers"),
		requestId: v.string(),
		kind: powerOperationKind,
	},
	returns: v.union(
		v.object({ ok: v.literal(true), operationId: v.id("serverOperations") }),
		failure,
	),
	handler: async (ctx, { serverId, requestId, kind }) => {
		const { user } = await requireServerAccess(ctx, serverId, "power");
		const allocation = await requireChangeableServerAllocation(ctx, serverId);
		requireRequestId(requestId);
		const previous = await getOperationByRequest(ctx, user._id, requestId);
		if (previous !== null) {
			return previous.serverId === serverId && previous.kind === kind
				? { ok: true as const, operationId: previous._id }
				: fail("request_id_conflict");
		}
		await requireRateLimit(ctx, "serverChange", user._id);
		return await requestAllocationPower(ctx, allocation, {
			requesterId: user._id,
			requestId,
			kind,
		});
	},
});

export const requestDelete = mutation({
	args: { serverId: v.id("servers") },
	returns: v.null(),
	handler: async (ctx, { serverId }) => {
		const { user } = await requireServerAccess(ctx, serverId, "delete");
		await requireChangeableServerAllocation(ctx, serverId);
		await requireRateLimit(ctx, "serverChange", user._id);
		await requestServerDelete(ctx, serverId, user._id);
		return null;
	},
});

export const getStatus = query({
	args: { serverId: v.id("servers") },
	returns: v.object({
		status: allocationStatus,
		// What each part of the server looked like when it was last seen, so that one part being
		// wrong says which, rather than stopping everything.
		parts: v.object({
			...allocationParts.fields,
			// What Composery's own way in looked like the last time anything used it.
			managementAccess: allocationPartState,
		}),
		// Why the allocation is not moving, when it is not. It is still being tried.
		stuck: v.union(v.object({ since: v.number(), code: v.string() }), v.null()),
		location: v.union(v.string(), v.null()),
		ipv4: v.union(v.string(), v.null()),
		ipv6: v.union(v.string(), v.null()),
		observedAt: v.union(v.number(), v.null()),
		// The pinned host key, which a client compares with the key the server offers.
		hostKey: v.union(v.string(), v.null()),
		hostKeyConflictAt: v.union(v.number(), v.null()),
		// The port that the server last reported, which a client needs to connect.
		port: v.union(v.number(), v.null()),
		// The hostname the server reports, which the customer may have changed themselves.
		hostname: v.union(v.string(), v.null()),
		operation: v.object({
			_id: v.id("serverOperations"),
			kind: operationKind,
			status: operationStatus,
			finishedAt: v.union(v.number(), v.null()),
		}),
	}),
	handler: async (ctx, { serverId }) => {
		await requireServerAccess(ctx, serverId);
		const allocation = await requireServerAllocation(ctx, serverId);
		const sshAccess = await getAllocationSshAccess(ctx, allocation._id);
		const operation = await ctx.db.get(
			"serverOperations",
			allocation.operationId,
		);
		if (operation === null) {
			throw new Error("The allocation's operation is missing.");
		}
		return {
			status: allocation.status,
			parts: {
				...allocation.parts,
				managementAccess: sshAccess?.access?.state ?? "unknown",
			},
			stuck:
				allocation.stuck === undefined
					? null
					: { since: allocation.stuck.since, code: allocation.stuck.code },
			location: allocation.location ?? null,
			ipv4: allocation.ipv4 ?? null,
			ipv6: allocation.ipv6 ?? null,
			observedAt: allocation.observedAt ?? null,
			hostKey: sshAccess?.hostKey ?? null,
			hostKeyConflictAt: sshAccess?.hostKeyConflictAt ?? null,
			port: sshAccess?.port ?? null,
			hostname: allocation.hostname ?? null,
			operation: {
				_id: operation._id,
				kind: operation.kind,
				status: operation.status,
				finishedAt: operation.finishedAt ?? null,
			},
		};
	},
});

/**
 * Runs after the allocation confirms that its infrastructure is gone. The server and the allocation
 * go in one change, so a server is never readable without the allocation that ran it.
 */
export const finishDelete = internalMutation({
	args: { allocationId: v.id("serverAllocations") },
	returns: v.null(),
	handler: async (ctx, { allocationId }) => {
		const allocation = await ctx.db.get("serverAllocations", allocationId);
		if (allocation === null) {
			return null;
		}
		const { serverId } = allocation;
		const server = await ctx.db.get("servers", serverId);
		await deleteServerAllocation(ctx, allocationId);
		if (server === null) {
			return null;
		}
		await releaseServerQuota(ctx, server.ownerId);
		await ctx.db.delete("servers", serverId);
		await ctx.scheduler.runAfter(0, internal.servers.memberships.removeAll, {
			serverId,
		});
		await ctx.scheduler.runAfter(
			0,
			internal.allocations.operations.removeOperations,
			{ serverId },
		);
		return null;
	},
});
