import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, mutation, query } from "../_generated/server";
import { requireChangeableServerAllocation } from "../allocations/operations";
import { toConvexError } from "../errors";
import { toBoundedPagination } from "../pagination";
import { transferServerQuota } from "../quotas";
import { requireRateLimit } from "../rate_limits";
import { getCurrentUser } from "../users";
import { requestServerDelete } from "./lifecycle";
import { requireServerMembership } from "./memberships";
import {
	allServerPermissions,
	ownerAccess,
	requireServerAccess,
	requireServerOwner,
} from "./permissions";
import { serverSummary, toServerSummary } from "./summary";

const deleteBatchSize = 20;

const ownerSummary = v.object({
	userId: v.id("users"),
	// Clerk makes both optional, so a caller must not be told there is always one.
	email: v.optional(v.string()),
	imageUrl: v.optional(v.string()),
});

/** Servers that the user owns. Shared servers are in memberships.listMine. */
export const listMine = query({
	args: { paginationOpts: paginationOptsValidator },
	returns: paginationResultValidator(serverSummary),
	handler: async (ctx, { paginationOpts }) => {
		const user = await getCurrentUser(ctx);
		if (user === null) {
			return { page: [], isDone: true, continueCursor: "" };
		}
		const result = await ctx.db
			.query("servers")
			.withIndex("by_owner_id", (q) => q.eq("ownerId", user._id))
			.paginate(toBoundedPagination(paginationOpts));
		return {
			...result,
			page: result.page.map((server) => toServerSummary(server, ownerAccess)),
		};
	},
});

export const getOwner = query({
	args: { serverId: v.id("servers") },
	returns: v.union(ownerSummary, v.null()),
	handler: async (ctx, { serverId }) => {
		const { server } = await requireServerAccess(ctx, serverId);
		const owner = await ctx.db.get("users", server.ownerId);
		return owner === null
			? null
			: {
					userId: owner._id,
					...(owner.email === undefined ? {} : { email: owner.email }),
					...(owner.imageUrl === undefined ? {} : { imageUrl: owner.imageUrl }),
				};
	},
});

/**
 * The new owner must already be a member. The previous owner keeps a membership with every permission.
 */
export const transfer = mutation({
	args: { membershipId: v.id("serverMemberships") },
	returns: v.null(),
	handler: async (ctx, { membershipId }) => {
		const membership = await requireServerMembership(ctx, membershipId);
		const access = await requireServerOwner(ctx, membership.serverId);
		await requireChangeableServerAllocation(ctx, membership.serverId);
		const newOwner = await ctx.db.get("users", membership.userId);
		if (newOwner === null) {
			throw toConvexError("membership_not_found");
		}
		const quotaFailure = await transferServerQuota(
			ctx,
			access.user._id,
			newOwner._id,
		);
		if (quotaFailure !== null) {
			throw toConvexError(quotaFailure.code);
		}
		await requireRateLimit(ctx, "serverChange", access.user._id);
		await ctx.db.delete("serverMemberships", membershipId);
		await ctx.db.insert("serverMemberships", {
			serverId: membership.serverId,
			userId: access.user._id,
			permissions: allServerPermissions,
		});
		await ctx.db.patch("servers", membership.serverId, {
			ownerId: newOwner._id,
		});
		return null;
	},
});

/**
 * Runs after a user is deleted. A server keeps its row until its infrastructure is gone, so the batches follow a cursor.
 */
export const requestDeleteForOwner = internalMutation({
	args: { userId: v.id("users"), cursor: v.union(v.string(), v.null()) },
	returns: v.null(),
	handler: async (ctx, { userId, cursor }) => {
		const result = await ctx.db
			.query("servers")
			.withIndex("by_owner_id", (q) => q.eq("ownerId", userId))
			.paginate({ numItems: deleteBatchSize, cursor });
		for (const server of result.page) {
			await requestServerDelete(ctx, server._id);
		}
		if (!result.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.servers.ownership.requestDeleteForOwner,
				{ userId, cursor: result.continueCursor },
			);
		}
		return null;
	},
});
