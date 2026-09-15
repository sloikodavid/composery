import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import { type Infer, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	query,
} from "../_generated/server";
import { fail, failure, toConvexError } from "../errors";
import { toBoundedPagination } from "../pagination";
import { checkRateLimit, requireRateLimit } from "../rate_limits";
import { getCurrentUser, isUserDisabled, requireUser } from "../users";
import {
	getServerMembership,
	hasServerPermissions,
	requireServerAccess,
	requireServerMembership,
	type ServerPermissions,
	serverSummary,
	toServerSummary,
} from "./access";
import { serverPermissions } from "./schema";

const removeBatchSize = 100;
// Bounds the people on one server, so each access check and member list stays small.
const maxMembershipsPerServer = 100;

const membershipSummary = v.object({
	_id: v.id("serverMemberships"),
	userId: v.id("users"),
	username: v.string(),
	imageUrl: v.string(),
	permissions: serverPermissions,
});

function requireDelegation(
	available: Readonly<ServerPermissions>,
	requested: Readonly<ServerPermissions>,
) {
	if (!hasServerPermissions(available, requested)) {
		throw toConvexError("permission_denied");
	}
}

async function isMembershipLimitReached(
	ctx: MutationCtx,
	serverId: Id<"servers">,
) {
	const memberships = await ctx.db
		.query("serverMemberships")
		.withIndex("by_server_id_and_user_id", (q) => q.eq("serverId", serverId))
		.take(maxMembershipsPerServer);
	return memberships.length === maxMembershipsPerServer;
}

/** Servers that other people share with the user. Owned servers are in ownership.listMine. */
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
			.paginate(toBoundedPagination(paginationOpts));
		const page: Infer<typeof serverSummary>[] = [];
		for (const membership of result.page) {
			const server = await ctx.db.get("servers", membership.serverId);
			if (server !== null) {
				page.push(
					toServerSummary(server, {
						isOwner: false,
						permissions: membership.permissions,
					}),
				);
			}
		}
		return { ...result, page };
	},
});

export const list = query({
	args: { serverId: v.id("servers"), paginationOpts: paginationOptsValidator },
	returns: paginationResultValidator(membershipSummary),
	handler: async (ctx, { serverId, paginationOpts }) => {
		await requireServerAccess(ctx, serverId);
		const result = await ctx.db
			.query("serverMemberships")
			.withIndex("by_server_id_and_user_id", (q) => q.eq("serverId", serverId))
			.paginate(toBoundedPagination(paginationOpts));
		const page: Infer<typeof membershipSummary>[] = [];
		for (const membership of result.page) {
			const user = await ctx.db.get("users", membership.userId);
			if (user !== null) {
				page.push({
					_id: membership._id,
					userId: user._id,
					username: user.username,
					imageUrl: user.imageUrl,
					permissions: membership.permissions,
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
			return fail("user_not_found", "username");
		}
		if (await isUserDisabled(ctx, user._id)) {
			return fail("user_disabled", "username");
		}
		if (
			user._id === access.server.ownerId ||
			(await getServerMembership(ctx, serverId, user._id)) !== null
		) {
			return fail("user_has_access", "username");
		}
		if (await isMembershipLimitReached(ctx, serverId)) {
			return fail("membership_limit_reached");
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
		const membership = await requireServerMembership(ctx, membershipId);
		const access = await requireServerAccess(
			ctx,
			membership.serverId,
			"manageMembers",
		);
		requireDelegation(access.permissions, membership.permissions);
		requireDelegation(access.permissions, permissions);
		await requireRateLimit(ctx, "serverChange", access.user._id);
		await ctx.db.patch("serverMemberships", membershipId, { permissions });
		return null;
	},
});

export const remove = mutation({
	args: { membershipId: v.id("serverMemberships") },
	returns: v.null(),
	handler: async (ctx, { membershipId }) => {
		const membership = await ctx.db.get("serverMemberships", membershipId);
		if (membership === null) {
			return null;
		}
		const user = await requireUser(ctx);
		const isLeaving = membership.userId === user._id;
		const access = await requireServerAccess(
			ctx,
			membership.serverId,
			isLeaving ? undefined : "manageMembers",
		);
		if (!isLeaving) {
			requireDelegation(access.permissions, membership.permissions);
		}
		await requireRateLimit(ctx, "serverChange", access.user._id);
		await ctx.db.delete("serverMemberships", membershipId);
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

/** Runs after a user is deleted. */
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
