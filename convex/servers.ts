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
	type QueryCtx,
	query,
} from "./_generated/server";
import { rateLimiter, tooManyAttemptsMessage } from "./limits";
import { memberRole, serverRole } from "./schema";
import {
	isReservedSlug,
	isValidSlugFormat,
	SLUG_FORMAT_MESSAGE,
} from "./slugs";
import { getCurrentUser } from "./users";

type ServerRole = Infer<typeof serverRole>;

const ROLE_RANK: Record<ServerRole, number> = { read: 0, write: 1, owner: 2 };
const DELETE_BATCH_SIZE = 100;

const serverSummary = v.object({
	_id: v.id("servers"),
	slug: v.string(),
	role: serverRole,
});

const memberSummary = v.object({
	_id: v.id("serverMembers"),
	userId: v.id("users"),
	username: v.string(),
	imageUrl: v.string(),
	role: serverRole,
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

async function requireUser(ctx: QueryCtx) {
	const user = await getCurrentUser(ctx);
	if (user === null) {
		throw new ConvexError({ message: "Sign in to continue." });
	}
	return user;
}

async function getMembership(
	ctx: QueryCtx,
	serverId: Id<"servers">,
	userId: Id<"users">,
) {
	return await ctx.db
		.query("serverMembers")
		.withIndex("by_server_id_and_user_id", (q) =>
			q.eq("serverId", serverId).eq("userId", userId),
		)
		.unique();
}

async function requireRole(
	ctx: QueryCtx,
	serverId: Id<"servers">,
	minimum: ServerRole,
) {
	const user = await requireUser(ctx);
	const membership = await getMembership(ctx, serverId, user._id);
	if (membership === null || ROLE_RANK[membership.role] < ROLE_RANK[minimum]) {
		throw new ConvexError({ message: "You do not have access to do this." });
	}
	return { user, membership };
}

async function limitServerChange(ctx: MutationCtx, userId: Id<"users">) {
	const status = await rateLimiter.limit(ctx, "serverChange", { key: userId });
	if (!status.ok) {
		throw new ConvexError({
			message: tooManyAttemptsMessage(status.retryAfter),
		});
	}
}

// Checks a slug for a new claim. Every check counts as an attempt, and only an available slug counts as a claim.
async function checkSlug(
	ctx: MutationCtx,
	userId: Id<"users">,
	slug: string,
): Promise<Failure | null> {
	const attempt = await rateLimiter.limit(ctx, "slugAttempt", { key: userId });
	if (!attempt.ok) {
		return fail(null, tooManyAttemptsMessage(attempt.retryAfter));
	}
	if (!isValidSlugFormat(slug)) {
		return fail("slug", SLUG_FORMAT_MESSAGE);
	}
	const taken = await ctx.db
		.query("serverSlugs")
		.withIndex("by_slug", (q) => q.eq("slug", slug))
		.unique();
	if (taken !== null || isReservedSlug(slug)) {
		return fail("slug", "This slug is taken.");
	}
	const claim = await rateLimiter.limit(ctx, "slugClaim", { key: userId });
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
					slug: server.slug,
					role: membership.role,
				});
			}
		}
		return { ...result, page };
	},
});

// Returns null when the slug is unknown or the user is not a member, so the response does not reveal which servers exist.
export const getBySlug = query({
	args: { slug: v.string() },
	returns: v.union(serverSummary, v.null()),
	handler: async (ctx, { slug }) => {
		const user = await getCurrentUser(ctx);
		if (user === null) {
			return null;
		}
		const slugRecord = await ctx.db
			.query("serverSlugs")
			.withIndex("by_slug", (q) => q.eq("slug", slug))
			.unique();
		if (slugRecord === null) {
			return null;
		}
		const server = await ctx.db.get("servers", slugRecord.serverId);
		if (server === null) {
			return null;
		}
		const membership = await getMembership(ctx, server._id, user._id);
		if (membership === null) {
			return null;
		}
		return { _id: server._id, slug: server.slug, role: membership.role };
	},
});

export const listMembers = query({
	args: { serverId: v.id("servers"), paginationOpts: paginationOptsValidator },
	returns: paginationResultValidator(memberSummary),
	handler: async (ctx, { serverId, paginationOpts }) => {
		await requireRole(ctx, serverId, "read");
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
					role: membership.role,
				});
			}
		}
		return { ...result, page };
	},
});

export const create = mutation({
	args: { slug: v.string() },
	returns: v.union(
		v.object({ ok: v.literal(true), slug: v.string() }),
		failure,
	),
	handler: async (ctx, { slug }) => {
		const user = await requireUser(ctx);
		const problem = await checkSlug(ctx, user._id, slug);
		if (problem !== null) {
			return problem;
		}
		const serverId = await ctx.db.insert("servers", { slug });
		await ctx.db.insert("serverSlugs", { slug, serverId });
		await ctx.db.insert("serverMembers", {
			serverId,
			userId: user._id,
			role: "owner",
		});
		return { ok: true as const, slug };
	},
});

export const rename = mutation({
	args: { serverId: v.id("servers"), slug: v.string() },
	returns: v.union(
		v.object({ ok: v.literal(true), slug: v.string() }),
		failure,
	),
	handler: async (ctx, { serverId, slug }) => {
		const { user } = await requireRole(ctx, serverId, "write");
		const server = await ctx.db.get("servers", serverId);
		if (server === null) {
			throw new ConvexError({ message: "This server no longer exists." });
		}
		if (server.slug === slug) {
			return { ok: true as const, slug };
		}
		const problem = await checkSlug(ctx, user._id, slug);
		if (problem !== null) {
			return problem;
		}
		await ctx.db.insert("serverSlugs", { slug, serverId });
		await ctx.db.patch("servers", serverId, { slug });
		return { ok: true as const, slug };
	},
});

export const addMember = mutation({
	args: { serverId: v.id("servers"), username: v.string(), role: memberRole },
	returns: v.union(v.object({ ok: v.literal(true) }), failure),
	handler: async (ctx, { serverId, username, role }) => {
		const { user: owner } = await requireRole(ctx, serverId, "owner");
		const lookup = await rateLimiter.limit(ctx, "memberLookup", {
			key: owner._id,
		});
		if (!lookup.ok) {
			return fail(null, tooManyAttemptsMessage(lookup.retryAfter));
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
		if ((await getMembership(ctx, serverId, user._id)) !== null) {
			return fail("username", "This user is already a member.");
		}
		await ctx.db.insert("serverMembers", { serverId, userId: user._id, role });
		return { ok: true as const };
	},
});

export const setMemberRole = mutation({
	args: { memberId: v.id("serverMembers"), role: memberRole },
	returns: v.null(),
	handler: async (ctx, { memberId, role }) => {
		const member = await ctx.db.get("serverMembers", memberId);
		if (member === null) {
			throw new ConvexError({ message: "This member no longer exists." });
		}
		const { user } = await requireRole(ctx, member.serverId, "owner");
		await limitServerChange(ctx, user._id);
		if (member.role === "owner") {
			throw new ConvexError({ message: "The owner's role cannot change." });
		}
		await ctx.db.patch("serverMembers", memberId, { role });
		return null;
	},
});

// The owner removes other members; any other member can remove themself.
export const removeMember = mutation({
	args: { memberId: v.id("serverMembers") },
	returns: v.null(),
	handler: async (ctx, { memberId }) => {
		const member = await ctx.db.get("serverMembers", memberId);
		if (member === null) {
			return null;
		}
		const { user, membership } = await requireRole(
			ctx,
			member.serverId,
			"read",
		);
		await limitServerChange(ctx, user._id);
		if (member.role === "owner") {
			throw new ConvexError({
				message: "The owner cannot leave. Delete the server instead.",
			});
		}
		if (membership.role !== "owner" && member.userId !== user._id) {
			throw new ConvexError({ message: "You do not have access to do this." });
		}
		await ctx.db.delete("serverMembers", memberId);
		return null;
	},
});

export const remove = mutation({
	args: { serverId: v.id("servers") },
	returns: v.null(),
	handler: async (ctx, { serverId }) => {
		const { user } = await requireRole(ctx, serverId, "owner");
		await limitServerChange(ctx, user._id);
		await ctx.db.delete("servers", serverId);
		await ctx.scheduler.runAfter(0, internal.servers.deleteMembers, {
			serverId,
		});
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
			if (membership.role === "owner") {
				const server = await ctx.db.get("servers", membership.serverId);
				if (server !== null) {
					await ctx.db.delete("servers", server._id);
					await ctx.scheduler.runAfter(0, internal.servers.deleteMembers, {
						serverId: server._id,
					});
				}
			}
		}
		if (memberships.length === DELETE_BATCH_SIZE) {
			await ctx.scheduler.runAfter(0, internal.servers.removeUserMemberships, {
				userId,
			});
		}
		return null;
	},
});
