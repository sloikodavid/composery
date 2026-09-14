import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import { ConvexError, type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	query,
} from "./_generated/server";
import { rateLimiter, tooManyAttemptsMessage } from "./limits";
import {
	isReservedName,
	isValidNameFormat,
	NAME_FORMAT_MESSAGE,
} from "./names";
import {
	getMembership,
	memberAccess,
	requireServerAccess,
	requireServerOwner,
	requireUser,
} from "./server_access";
import {
	deleteServer,
	provision,
	requestKey,
	reserve,
} from "./server_lifecycle";
import {
	allServerPermissions,
	includesPermissions,
	serverPermissions,
} from "./server_permissions";
import { getCurrentUser } from "./users";

const DELETE_BATCH_SIZE = 100;

const serverSummary = v.object({
	_id: v.id("servers"),
	name: v.string(),
	isOwner: v.boolean(),
	permissions: serverPermissions,
});

const memberSummary = v.object({
	_id: v.id("serverMembers"),
	userId: v.id("users"),
	username: v.string(),
	imageUrl: v.string(),
	isOwner: v.boolean(),
	permissions: serverPermissions,
});

// Expected failures are returned instead of thrown, so a rate limit attempt they consume is not rolled back.
const failure = v.object({
	ok: v.literal(false),
	field: v.union(v.string(), v.null()),
	message: v.string(),
});

type Failure = Infer<typeof failure>;

function fail(field: string | null, message: string): Failure {
	return { ok: false, field, message };
}

async function limitServerChange(ctx: MutationCtx, userId: Id<"users">) {
	const status = await rateLimiter.limit(ctx, "serverChange", { key: userId });
	if (!status.ok) {
		throw new ConvexError({
			message: tooManyAttemptsMessage(status.retryAfter),
		});
	}
}

// Checks a name for a new claim. Every check counts as an attempt, and only an available name counts as a claim.
async function checkName(
	ctx: MutationCtx,
	userId: Id<"users">,
	name: string,
	serverId?: Id<"servers">,
): Promise<Failure | null> {
	const attempt = await rateLimiter.limit(ctx, "nameAttempt", { key: userId });
	if (!attempt.ok) {
		return fail(null, tooManyAttemptsMessage(attempt.retryAfter));
	}
	if (!isValidNameFormat(name)) {
		return fail("name", NAME_FORMAT_MESSAGE);
	}
	const taken = await ctx.db
		.query("serverNames")
		.withIndex("by_name", (q) => q.eq("name", name))
		.unique();
	if (taken !== null && taken.serverId === serverId) return null;
	if (taken !== null || isReservedName(name)) {
		return fail("name", "This name is taken.");
	}
	const claim = await rateLimiter.limit(ctx, "nameClaim", { key: userId });
	if (!claim.ok) {
		return fail(null, tooManyAttemptsMessage(claim.retryAfter));
	}
	return null;
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
			.query("serverMembers")
			.withIndex("by_user_id", (q) => q.eq("userId", user._id))
			.paginate(paginationOpts);
		const page: Infer<typeof serverSummary>[] = [];
		for (const membership of result.page) {
			const server = await ctx.db.get("servers", membership.serverId);
			if (server !== null) {
				page.push({
					_id: server._id,
					name: server.name,
					...memberAccess(server, membership),
				});
			}
		}
		return { ...result, page };
	},
});

// Returns null when the name is unknown or the user is not a member, so the response does not reveal which servers exist.
export const getByName = query({
	args: { name: v.string() },
	returns: v.union(serverSummary, v.null()),
	handler: async (ctx, { name }) => {
		const user = await getCurrentUser(ctx);
		if (user === null) {
			return null;
		}
		const nameRecord = await ctx.db
			.query("serverNames")
			.withIndex("by_name", (q) => q.eq("name", name))
			.unique();
		if (nameRecord === null) {
			return null;
		}
		const server = await ctx.db.get("servers", nameRecord.serverId);
		if (server === null) {
			return null;
		}
		const membership = await getMembership(ctx, server._id, user._id);
		if (membership === null) {
			return null;
		}
		return {
			_id: server._id,
			name: server.name,
			...memberAccess(server, membership),
		};
	},
});

export const listMembers = query({
	args: { serverId: v.id("servers"), paginationOpts: paginationOptsValidator },
	returns: paginationResultValidator(memberSummary),
	handler: async (ctx, { serverId, paginationOpts }) => {
		const { server } = await requireServerAccess(ctx, serverId);
		const result = await ctx.db
			.query("serverMembers")
			.withIndex("by_server_id_and_user_id", (q) => q.eq("serverId", serverId))
			.paginate(paginationOpts);
		const page: Infer<typeof memberSummary>[] = [];
		for (const membership of result.page) {
			const user = await ctx.db.get("users", membership.userId);
			if (user !== null) {
				page.push({
					_id: membership._id,
					userId: user._id,
					username: user.username,
					imageUrl: user.imageUrl,
					...memberAccess(server, membership),
				});
			}
		}
		return { ...result, page };
	},
});

export const create = mutation({
	args: { name: v.string(), requestId: v.string() },
	returns: v.union(
		v.object({ ok: v.literal(true), name: v.string() }),
		failure,
	),
	handler: async (ctx, { name, requestId }) => {
		const user = await requireUser(ctx);
		requestKey(requestId);
		const previous = await ctx.db
			.query("serverOperations")
			.withIndex("by_requester_id_and_request_id", (q) =>
				q.eq("requesterId", user._id).eq("requestId", requestId),
			)
			.unique();
		if (previous) {
			if (previous.kind !== "create")
				return fail(null, "This request ID was used for another command.");
			if (previous.name !== name)
				return fail(null, "This request ID was used for another name.");
			const server = await ctx.db.get("servers", previous.serverId);
			return server
				? { ok: true as const, name: server.name }
				: fail(null, "This server was deleted.");
		}
		const problem = await checkName(ctx, user._id, name);
		if (problem !== null) {
			return problem;
		}
		const reservation = await reserve(ctx, user._id);
		if (!reservation)
			return fail(
				null,
				"Server provisioning is not enabled or your server limit is reached.",
			);
		const serverId = await ctx.db.insert("servers", {
			name,
			ownerId: user._id,
		});
		await ctx.db.insert("serverNames", { name, serverId });
		await ctx.db.insert("serverMembers", {
			serverId,
			userId: user._id,
			permissions: allServerPermissions,
		});
		await provision(ctx, serverId, user._id, requestId, name, reservation);
		return { ok: true as const, name };
	},
});

export const rename = mutation({
	args: { serverId: v.id("servers"), name: v.string() },
	returns: v.union(
		v.object({ ok: v.literal(true), name: v.string() }),
		failure,
	),
	handler: async (ctx, { serverId, name }) => {
		const { user, server } = await requireServerAccess(ctx, serverId, "rename");
		if (server.name === name) {
			return { ok: true as const, name };
		}
		const problem = await checkName(ctx, user._id, name, serverId);
		if (problem !== null) {
			return problem;
		}
		const claim = await ctx.db
			.query("serverNames")
			.withIndex("by_name", (q) => q.eq("name", name))
			.unique();
		if (claim === null) await ctx.db.insert("serverNames", { name, serverId });
		await ctx.db.patch("servers", serverId, { name });
		return { ok: true as const, name };
	},
});

function requireDelegation(
	available: Infer<typeof serverPermissions>,
	requested: Infer<typeof serverPermissions>,
) {
	if (!includesPermissions(available, requested))
		throw new ConvexError({
			message: "You cannot change permissions outside your own access.",
		});
}

export const addMember = mutation({
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
		const lookup = await rateLimiter.limit(ctx, "memberLookup", {
			key: access.user._id,
		});
		if (!lookup.ok)
			return fail(null, tooManyAttemptsMessage(lookup.retryAfter));
		const user = await ctx.db
			.query("users")
			.withIndex("by_username", (q) =>
				q.eq("username", username.trim().toLowerCase()),
			)
			.unique();
		if (user === null) return fail("username", "No user has this username.");
		const status = await ctx.db
			.query("userAccess")
			.withIndex("by_user_id", (q) => q.eq("userId", user._id))
			.unique();
		if (status?.disabled)
			return fail("username", "This user cannot receive server access.");
		if (await getMembership(ctx, serverId, user._id))
			return fail("username", "This user is already a member.");
		await ctx.db.insert("serverMembers", {
			serverId,
			userId: user._id,
			permissions: granted,
		});
		return { ok: true as const };
	},
});

export const setMemberPermissions = mutation({
	args: { memberId: v.id("serverMembers"), permissions: serverPermissions },
	returns: v.null(),
	handler: async (ctx, { memberId, permissions }) => {
		const member = await ctx.db.get("serverMembers", memberId);
		if (!member)
			throw new ConvexError({ message: "This member no longer exists." });
		const access = await requireServerAccess(
			ctx,
			member.serverId,
			"manageMembers",
		);
		if (member.userId === access.server.ownerId)
			throw new ConvexError({
				message: "The owner always has every permission.",
			});
		requireDelegation(access.permissions, member.permissions);
		requireDelegation(access.permissions, permissions);
		await limitServerChange(ctx, access.user._id);
		await ctx.db.patch("serverMembers", memberId, { permissions });
		return null;
	},
});

// Leaving or removing a membership does not change native SSH authorizations.
export const removeMember = mutation({
	args: { memberId: v.id("serverMembers") },
	returns: v.null(),
	handler: async (ctx, { memberId }) => {
		const member = await ctx.db.get("serverMembers", memberId);
		if (!member) return null;
		const access = await requireServerAccess(ctx, member.serverId);
		if (member.userId === access.server.ownerId)
			throw new ConvexError({
				message: "Transfer ownership or delete the server before leaving.",
			});
		if (member.userId !== access.user._id) {
			if (!access.permissions.manageMembers)
				throw new ConvexError({
					message: "You do not have access to do this.",
				});
			requireDelegation(access.permissions, member.permissions);
		}
		await limitServerChange(ctx, access.user._id);
		await ctx.db.delete("serverMembers", memberId);
		return null;
	},
});

export const transferOwnership = mutation({
	args: { memberId: v.id("serverMembers") },
	returns: v.null(),
	handler: async (ctx, { memberId }) => {
		const member = await ctx.db.get("serverMembers", memberId);
		if (!member)
			throw new ConvexError({ message: "This member no longer exists." });
		const access = await requireServerOwner(ctx, member.serverId);
		if (member.userId === access.user._id) return null;
		const user = await ctx.db.get("users", member.userId);
		const status = await ctx.db
			.query("userAccess")
			.withIndex("by_user_id", (q) => q.eq("userId", member.userId))
			.unique();
		if (!user || status?.disabled)
			throw new ConvexError({ message: "This user cannot receive ownership." });
		const allocation = await ctx.db
			.query("serverAllocations")
			.withIndex("by_server_id", (q) => q.eq("serverId", member.serverId))
			.unique();
		if (allocation?.deleteRequested)
			throw new ConvexError({
				message: "A server being deleted cannot change ownership.",
			});
		await limitServerChange(ctx, access.user._id);
		await ctx.db.patch("servers", member.serverId, { ownerId: member.userId });
		await ctx.db.patch("serverMembers", access.membership._id, {
			permissions: allServerPermissions,
		});
		await ctx.db.patch("serverMembers", memberId, {
			permissions: allServerPermissions,
		});
		return null;
	},
});

export const remove = mutation({
	args: { serverId: v.id("servers") },
	returns: v.null(),
	handler: async (ctx, { serverId }) => {
		const { user } = await requireServerAccess(ctx, serverId, "delete");
		await limitServerChange(ctx, user._id);
		await deleteServer(ctx, serverId, user._id);
		return null;
	},
});

export const deleteMembers = internalMutation({
	args: { serverId: v.id("servers") },
	returns: v.null(),
	handler: async (ctx, { serverId }) => {
		const members = await ctx.db
			.query("serverMembers")
			.withIndex("by_server_id_and_user_id", (q) => q.eq("serverId", serverId))
			.take(DELETE_BATCH_SIZE);
		for (const member of members) {
			await ctx.db.delete("serverMembers", member._id);
		}
		if (members.length === DELETE_BATCH_SIZE) {
			await ctx.scheduler.runAfter(0, internal.servers.deleteMembers, {
				serverId,
			});
		}
		return null;
	},
});

// Runs after a user is deleted. A server whose owner is deleted is deleted too.
export const removeUserMemberships = internalMutation({
	args: { userId: v.id("users") },
	returns: v.null(),
	handler: async (ctx, { userId }) => {
		const memberships = await ctx.db
			.query("serverMembers")
			.withIndex("by_user_id", (q) => q.eq("userId", userId))
			.take(DELETE_BATCH_SIZE);
		for (const membership of memberships) {
			await ctx.db.delete("serverMembers", membership._id);
			const server = await ctx.db.get("servers", membership.serverId);
			if (server?.ownerId === userId) await deleteServer(ctx, server._id);
		}
		if (memberships.length === DELETE_BATCH_SIZE) {
			await ctx.scheduler.runAfter(0, internal.servers.removeUserMemberships, {
				userId,
			});
		}
		return null;
	},
});
