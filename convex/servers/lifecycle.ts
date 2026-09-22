import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { type MutationCtx, query } from "../_generated/server";
import { getHetznerCloudAllocation } from "../allocations/hetzner_cloud/worker_state";
import {
	deleteServerAllocation,
	getAllocationConfig,
	getOperationByRequest,
	removeServerOperations,
	requestAllocationCreate,
	requestAllocationDelete,
	requestAllocationPower,
	requireChangeableServerAllocation,
	requireRequestId,
	requireServerAllocation,
} from "../allocations/operations";
import { failureClass } from "../allocations/retries";
import {
	allocationStatus,
	getAllocationStuck,
	isAllocationDeleting,
	operationKind,
	operationStatus,
	powerOperationKind,
} from "../allocations/schema";
import { fail, failure, toConvexError } from "../errors";
import { internalMutation, mutation } from "../functions";
import { requireRateLimit } from "../rate_limits";
import { getAllocationSshAccess } from "../ssh/access_state";
import { requireUser } from "../users";
import { checkServerNameClaim, claimServerName } from "./names";
import { requireServerAccess } from "./permissions";
import { getServerQuotaFailure } from "./quota_usage";
import { serverFeatures, serverParts, toServerFeatures } from "./summary";

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
		v.object({
			ok: v.literal(true),
			serverId: v.id("servers"),
			name: v.string(),
		}),
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
				: { ok: true as const, serverId: server._id, name: server.name };
		}
		const claimFailure = await checkServerNameClaim(ctx, user._id, name);
		if (claimFailure !== null) {
			return claimFailure;
		}
		const config = getAllocationConfig();
		if (config === null) {
			return fail("server_capacity_unavailable");
		}
		const quotaFailure = await getServerQuotaFailure(ctx, user._id);
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
		return { ok: true as const, serverId, name };
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
		requireRequestId(requestId);
		const previous = await getOperationByRequest(ctx, user._id, requestId);
		if (previous !== null) {
			return previous.serverId === serverId && previous.kind === kind
				? { ok: true as const, operationId: previous._id }
				: fail("request_id_conflict");
		}
		const allocation = await requireChangeableServerAllocation(ctx, serverId);
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
		const allocation = await requireServerAllocation(ctx, serverId);
		if (isAllocationDeleting(allocation)) {
			return null;
		}
		await requireRateLimit(ctx, "serverChange", user._id);
		await requestAllocationDelete(ctx, allocation, user._id);
		return null;
	},
});

export const getStatus = query({
	args: { serverId: v.id("servers") },
	returns: v.object({
		status: allocationStatus,
		parts: serverParts,
		features: serverFeatures,
		stuck: v.union(
			v.object({ since: v.number(), code: v.string(), class: failureClass }),
			v.null(),
		),
		location: v.union(v.string(), v.null()),
		ipv4: v.union(v.string(), v.null()),
		ipv6: v.union(v.string(), v.null()),
		ipv6Network: v.union(v.string(), v.null()),
		observedAt: v.union(v.number(), v.null()),
		hostKey: v.union(v.string(), v.null()),
		hostKeyConflictAt: v.union(v.number(), v.null()),
		port: v.union(v.number(), v.null()),
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
		const provider = await getHetznerCloudAllocation(ctx, allocation._id);
		const parts = {
			...allocation.parts,
			managementAccess: sshAccess?.access?.status ?? "unknown",
		};
		const operation = await ctx.db.get(
			"serverOperations",
			allocation.operationId,
		);
		if (operation === null) {
			// Every allocation names its current operation; absence is a data defect.
			throw toConvexError("server_broken");
		}
		return {
			status: allocation.status,
			parts,
			features: toServerFeatures(parts),
			stuck: getAllocationStuck(allocation.failure),
			location: provider?.spec?.location ?? null,
			ipv4: allocation.ipv4 ?? null,
			ipv6: allocation.ipv6Address ?? null,
			ipv6Network: allocation.ipv6 ?? null,
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
		await ctx.db.delete("servers", serverId);
		await ctx.scheduler.runAfter(0, internal.servers.memberships.removeAll, {
			serverId,
		});
		await removeServerOperations(ctx, serverId);
		return null;
	},
});
