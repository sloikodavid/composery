import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import { ConvexError, type Infer, v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, mutation, query } from "../_generated/server";
import { getServerAllocation } from "../allocations/operations";
import { fail, failure } from "../failures";
import { checkRateLimit, requireRateLimit } from "../rate_limits";
import { getCurrentUser, isUserDisabled } from "../users";
import {
	allServerPermissions,
	getServerMembership,
	hasServerPermissions,
	requireServerAccess,
	requireServerOwner,
	type ServerPermissions,
	serverSummary,
	toServerAccess,
	toServerSummary,
} from "./access";
import { requestServerDelete } from "./lifecycle";
import { serverPermissions } from "./schema";

const removeBatchSize = 100;

const membershipSummary = v.object({
	_id: v.id("serverMemberships"),
	userId: v.id("users"),
	username: v.string(),
	imageUrl: v.string(),
	isOwner: v.boolean(),
	permissions: serverPermissions,
});

function requireDelegation(
	available: Readonly<ServerPermissions>,
	requested: Readonly<ServerPermissions>,
) {
	if (!hasServerPermissions(available, requested)) {
		throw new ConvexError({
			message: "You cannot change permissions outside your own access.",
		});
	}
}

export const listMine = query({
	args: { paginationOpts: paginationOptsValidator },
	returns: paginationResultValidator(serverSummary),
	handler: async (ctx, { paginationOpts }) => {
		const user = await getCurrentUser(ctx);
		if (user === null) {
			return { page: [], isDone: true, continueCursor: "" };
		}
		const result = await ctx.db
			.query("serverMemberships")
			.withIndex("by_user_id", (q) => q.eq("userId", user._id))
			.paginate(paginationOpts);
		const page: Infer<typeof serverSummary>[] = [];
		for (const membership of result.page) {
			const server = await ctx.db.get("servers", membership.serverId);
			if (server !== null) {
				page.push(toServerSummary(server, membership));
			}
		}
		return { ...result, page };
	},
});

export const list = query({
	args: { serverId: v.id("servers"), paginationOpts: paginationOptsValidator },
	returns: paginationResultValidator(membershipSummary),
	handler: async (ctx, { serverId, paginationOpts }) => {
		const { server } = await requireServerAccess(ctx, serverId);
		const result = await ctx.db
			.query("serverMemberships")
			.withIndex("by_server_id_and_user_id", (q) => q.eq("serverId", serverId))
			.paginate(paginationOpts);
		const page: Infer<typeof membershipSummary>[] = [];
		for (const membership of result.page) {
			const user = await ctx.db.get("users", membership.userId);
			if (user !== null) {
				page.push({
					_id: membership._id,
					userId: user._id,
					username: user.username,
					imageUrl: user.imageUrl,
					...toServerAccess(server, membership),
				});
			}
		}
		return { ...result, page };
	},
});

export const add = mutation({
	args: {
		serverId: v.id("servers"),
		username: v.string(),
		permissions: v.optional(serverPermissions),
	},
	returns: v.union(v.object({ ok: v.literal(true) }), failure),
	handler: async (ctx, { serverId, username, permissions }) => {
		const access = await requireServerAccess(ctx, serverId, "manageMembers");
		const granted = permissions ?? access.permissions;
		requireDelegation(access.permissions, granted);
		const lookupFailure = await checkRateLimit(
			ctx,
			"serverMemberLookup",
			access.user._id,
		);
		if (lookupFailure !== null) {
			return lookupFailure;
		}
		const user = await ctx.db
			.query("users")
			.withIndex("by_username", (q) =>
				q.eq("username", username.trim().toLowerCase()),
			)
			.unique();
		if (user === null) {
			return fail("username", "No user has this username.");
		}
		if (await isUserDisabled(ctx, user._id)) {
			return fail("username", "This user cannot receive server access.");
		}
		if ((await getServerMembership(ctx, serverId, user._id)) !== null) {
			return fail("username", "This user is already a member.");
		}
		await ctx.db.insert("serverMemberships", {
			serverId,
			userId: user._id,
			permissions: granted,
		});
		return { ok: true as const };
	},
});

export const setPermissions = mutation({
	args: {
		membershipId: v.id("serverMemberships"),
		permissions: serverPermissions,
	},
	returns: v.null(),
	handler: async (ctx, { membershipId, permissions }) => {
		const membership = await ctx.db.get("serverMemberships", membershipId);
		if (membership === null) {
			throw new ConvexError({ message: "This member no longer exists." });
		}
		const access = await requireServerAccess(
			ctx,
			membership.serverId,
			"manageMembers",
		);
		if (membership.userId === access.server.ownerId) {
			throw new ConvexError({
				message: "The owner always has every permission.",
			});
		}
		requireDelegation(access.permissions, membership.permissions);
		requireDelegation(access.permissions, permissions);
		await requireRateLimit(ctx, "serverChange", access.user._id);
		await ctx.db.patch("serverMemberships", membershipId, { permissions });
		return null;
	},
});

// Leaving or removing a membership does not change native SSH authorizations.
export const remove = mutation({
	args: { membershipId: v.id("serverMemberships") },
	returns: v.null(),
	handler: async (ctx, { membershipId }) => {
		const membership = await ctx.db.get("serverMemberships", membershipId);
		if (membership === null) {
			return null;
		}
		const access = await requireServerAccess(ctx, membership.serverId);
		if (membership.userId === access.server.ownerId) {
			throw new ConvexError({
				message: "Transfer ownership or delete the server before leaving.",
			});
		}
		if (membership.userId !== access.user._id) {
			if (!access.permissions.manageMembers) {
				throw new ConvexError({
					message: "You do not have access to do this.",
				});
			}
			requireDelegation(access.permissions, membership.permissions);
		}
		await requireRateLimit(ctx, "serverChange", access.user._id);
		await ctx.db.delete("serverMemberships", membershipId);
		return null;
	},
});

export const transferOwnership = mutation({
	args: { membershipId: v.id("serverMemberships") },
	returns: v.null(),
	handler: async (ctx, { membershipId }) => {
		const membership = await ctx.db.get("serverMemberships", membershipId);
		if (membership === null) {
			throw new ConvexError({ message: "This member no longer exists." });
		}
		const access = await requireServerOwner(ctx, membership.serverId);
		if (membership.userId === access.user._id) {
			return null;
		}
		const user = await ctx.db.get("users", membership.userId);
		if (user === null || (await isUserDisabled(ctx, user._id))) {
			throw new ConvexError({ message: "This user cannot receive ownership." });
		}
		const allocation = await getServerAllocation(ctx, membership.serverId);
		if (allocation?.deleteRequested) {
			throw new ConvexError({
				message: "A server that is being deleted cannot change ownership.",
			});
		}
		await requireRateLimit(ctx, "serverChange", access.user._id);
		await ctx.db.patch("servers", membership.serverId, {
			ownerId: membership.userId,
		});
		await ctx.db.patch("serverMemberships", access.membership._id, {
			permissions: allServerPermissions,
		});
		await ctx.db.patch("serverMemberships", membershipId, {
			permissions: allServerPermissions,
		});
		return null;
	},
});

export const removeAll = internalMutation({
	args: { serverId: v.id("servers") },
	returns: v.null(),
	handler: async (ctx, { serverId }) => {
		const memberships = await ctx.db
			.query("serverMemberships")
			.withIndex("by_server_id_and_user_id", (q) => q.eq("serverId", serverId))
			.take(removeBatchSize);
		for (const membership of memberships) {
			await ctx.db.delete("serverMemberships", membership._id);
		}
		if (memberships.length === removeBatchSize) {
			await ctx.scheduler.runAfter(0, internal.servers.memberships.removeAll, {
				serverId,
			});
		}
		return null;
	},
});

// Runs after a user is deleted. Deleting the owner also deletes the server.
export const removeForUser = internalMutation({
	args: { userId: v.id("users") },
	returns: v.null(),
	handler: async (ctx, { userId }) => {
		const memberships = await ctx.db
			.query("serverMemberships")
			.withIndex("by_user_id", (q) => q.eq("userId", userId))
			.take(removeBatchSize);
		for (const membership of memberships) {
			await ctx.db.delete("serverMemberships", membership._id);
			const server = await ctx.db.get("servers", membership.serverId);
			if (server?.ownerId === userId) {
				await requestServerDelete(ctx, server._id);
			}
		}
		if (memberships.length === removeBatchSize) {
			await ctx.scheduler.runAfter(
				0,
				internal.servers.memberships.removeForUser,
				{ userId },
			);
		}
		return null;
	},
});
