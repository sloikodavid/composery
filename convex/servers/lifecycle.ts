import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	query,
} from "../_generated/server";
import { reserveServerGrant } from "../allocations/grants";
import {
	getAllocationConfig,
	getOperationByRequest,
	getServerAllocation,
	requestAllocationCreate,
	requestAllocationDelete,
	requestAllocationPower,
	requireRequestId,
} from "../allocations/operations";
import { allocationStatus, powerOperationKind } from "../allocations/schema";
import { fail, failure } from "../failures";
import { requireRateLimit } from "../rate_limits";
import schema from "../schema";
import { getAllocationSshAccess } from "../ssh/bootstrap_state";
import { requireUser } from "../users";
import { allServerPermissions, requireServerAccess } from "./access";
import { checkServerNameClaim, claimServerName } from "./names";

async function deleteServerData(ctx: MutationCtx, serverId: Id<"servers">) {
	if ((await ctx.db.get("servers", serverId)) !== null) {
		await ctx.db.delete("servers", serverId);
	}
	await ctx.scheduler.runAfter(0, internal.servers.memberships.removeAll, {
		serverId,
	});
}

/** Deletes a server without infrastructure at once. Otherwise the allocation deletes its infrastructure first. */
export async function requestServerDelete(
	ctx: MutationCtx,
	serverId: Id<"servers">,
	requesterId?: Id<"users">,
) {
	const allocation = await getServerAllocation(ctx, serverId);
	if (allocation === null) {
		await deleteServerData(ctx, serverId);
		return;
	}
	await requestAllocationDelete(ctx, allocation, requesterId);
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
			if (previous.kind !== "create") {
				return fail(null, "This request ID was used for another operation.");
			}
			if (previous.name !== name) {
				return fail(null, "This request ID was used for another name.");
			}
			const server = await ctx.db.get("servers", previous.serverId);
			return server === null
				? fail(null, "This server was deleted.")
				: { ok: true as const, name: server.name };
		}
		const claimFailure = await checkServerNameClaim(ctx, user._id, name);
		if (claimFailure !== null) {
			return claimFailure;
		}
		const config = getAllocationConfig();
		if (config === null) {
			return fail(null, "Server creation is not enabled.");
		}
		const grantId = await reserveServerGrant(ctx, user._id);
		if (grantId === null) {
			return fail(null, "You have reached your server limit.");
		}
		const serverId = await ctx.db.insert("servers", {
			name,
			ownerId: user._id,
		});
		await claimServerName(ctx, name, serverId);
		await ctx.db.insert("serverMemberships", {
			serverId,
			userId: user._id,
			permissions: allServerPermissions,
		});
		await requestAllocationCreate(ctx, {
			serverId,
			requesterId: user._id,
			requestId,
			name,
			grantId,
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
		requireRequestId(requestId);
		const previous = await getOperationByRequest(ctx, user._id, requestId);
		if (previous !== null) {
			if (previous.serverId !== serverId || previous.kind !== kind) {
				return fail(null, "This request ID was used for another operation.");
			}
			return { ok: true as const, operationId: previous._id };
		}
		await requireRateLimit(ctx, "serverChange", user._id);
		const allocation = await getServerAllocation(ctx, serverId);
		if (allocation === null) {
			return fail(null, "This server cannot accept a power operation.");
		}
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
		await requireRateLimit(ctx, "serverChange", user._id);
		await requestServerDelete(ctx, serverId, user._id);
		return null;
	},
});

export const getStatus = query({
	args: { serverId: v.id("servers") },
	returns: v.union(
		v.null(),
		v.object({
			status: allocationStatus,
			error: v.union(v.string(), v.null()),
			location: v.union(v.string(), v.null()),
			ipv4: v.union(v.string(), v.null()),
			ipv6: v.union(v.string(), v.null()),
			observedAt: v.union(v.number(), v.null()),
			ssh: v.union(
				v.null(),
				v.object({
					hostKey: v.union(v.string(), v.null()),
					bootstrapExpiresAt: v.number(),
				}),
			),
			operation: v.union(v.null(), schema.doc("serverOperations")),
		}),
	),
	handler: async (ctx, { serverId }) => {
		await requireServerAccess(ctx, serverId);
		const allocation = await getServerAllocation(ctx, serverId);
		if (allocation === null) {
			return null;
		}
		const sshAccess = await getAllocationSshAccess(ctx, allocation._id);
		return {
			status: allocation.status,
			error: allocation.error ?? null,
			location: allocation.location ?? null,
			ipv4: allocation.ipv4 ?? null,
			ipv6: allocation.ipv6 ?? null,
			observedAt: allocation.observedAt ?? null,
			// A registered host key is a pin, not proof of a successful SSH connection.
			ssh:
				sshAccess === null
					? null
					: {
							hostKey: sshAccess.hostKey ?? null,
							bootstrapExpiresAt: sshAccess.bootstrapExpiresAt,
						},
			operation: await ctx.db.get("serverOperations", allocation.operationId),
		};
	},
});

// Runs after the allocation confirms that its infrastructure is gone.
export const finishDelete = internalMutation({
	args: { serverId: v.id("servers") },
	returns: v.null(),
	handler: async (ctx, { serverId }) => {
		await deleteServerData(ctx, serverId);
		return null;
	},
});
