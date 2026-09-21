import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	type MutationCtx,
	type QueryCtx,
	query,
} from "./_generated/server";
import { toConvexError } from "./errors";
import { deleteUserQuotas } from "./quotas";
import { userFields } from "./schema";

async function getUserByClerkId(ctx: QueryCtx, clerkUserId: string) {
	return await ctx.db
		.query("users")
		.withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId))
		.unique();
}

async function getUserSync(ctx: QueryCtx, clerkUserId: string) {
	return await ctx.db
		.query("userSyncs")
		.withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId))
		.unique();
}

export async function getCurrentUser(ctx: QueryCtx) {
	const identity = await ctx.auth.getUserIdentity();
	if (identity === null) {
		return null;
	}
	return await getUserByClerkId(ctx, identity.subject);
}

export async function requireUser(ctx: QueryCtx) {
	const user = await getCurrentUser(ctx);
	if (user === null) {
		throw toConvexError("unauthenticated");
	}
	return user;
}

export const getCurrent = query({
	args: {},
	returns: v.union(
		v.object({
			_id: v.id("users"),
			clerkUserId: v.string(),
			email: v.union(v.string(), v.null()),
			imageUrl: v.union(v.string(), v.null()),
		}),
		v.null(),
	),
	handler: async (ctx) => {
		const user = await getCurrentUser(ctx);
		return user === null
			? null
			: {
					_id: user._id,
					clerkUserId: user.clerkUserId,
					email: user.email ?? null,
					imageUrl: user.imageUrl ?? null,
				};
	},
});

export const isSynced = internalQuery({
	args: { clerkUserId: v.string() },
	returns: v.boolean(),
	handler: async (ctx, { clerkUserId }) =>
		(await getUserByClerkId(ctx, clerkUserId)) !== null,
});

export const listClerkIds = internalQuery({
	args: { paginationOpts: paginationOptsValidator },
	returns: paginationResultValidator(v.string()),
	handler: async (ctx, { paginationOpts }) => {
		const result = await ctx.db.query("users").paginate(paginationOpts);
		return { ...result, page: result.page.map((user) => user.clerkUserId) };
	},
});

function isSameUser(existing: Doc<"users">, fields: Infer<typeof userFields>) {
	return (
		existing.email === fields.email && existing.imageUrl === fields.imageUrl
	);
}

function requireEpoch(epoch: number) {
	if (!Number.isSafeInteger(epoch) || epoch < 1) {
		throw new Error("A user sync epoch must be a positive integer.");
	}
}

async function storeUsers(
	ctx: MutationCtx,
	users: Infer<typeof userFields>[],
	epoch: number,
) {
	requireEpoch(epoch);
	for (const fields of users) {
		const sync = await getUserSync(ctx, fields.clerkUserId);
		if (sync?.status === "removed" || (sync !== null && epoch <= sync.epoch)) {
			continue;
		}
		if (sync === null) {
			await ctx.db.insert("userSyncs", {
				clerkUserId: fields.clerkUserId,
				epoch,
				status: "active",
			});
		} else {
			await ctx.db.patch("userSyncs", sync._id, { epoch, status: "active" });
		}
		const existing = await getUserByClerkId(ctx, fields.clerkUserId);
		if (existing === null) {
			await ctx.db.insert("users", fields);
		} else if (!isSameUser(existing, fields)) {
			// Replace removes fields Clerk no longer sends; patch would retain stale data.
			await ctx.db.replace("users", existing._id, fields);
		}
	}
}

async function removeUsers(
	ctx: MutationCtx,
	clerkUserIds: string[],
	epoch: number,
) {
	requireEpoch(epoch);
	for (const clerkUserId of clerkUserIds) {
		const sync = await getUserSync(ctx, clerkUserId);
		if (sync?.status === "removed" || (sync !== null && epoch <= sync.epoch)) {
			continue;
		}
		if (sync === null) {
			await ctx.db.insert("userSyncs", {
				clerkUserId,
				epoch,
				status: "removed",
			});
		} else {
			await ctx.db.patch("userSyncs", sync._id, {
				epoch,
				status: "removed",
			});
		}
		const user = await getUserByClerkId(ctx, clerkUserId);
		if (user === null) {
			continue;
		}
		await deleteUserQuotas(ctx, user._id);
		await ctx.db.delete("users", user._id);
		await ctx.scheduler.runAfter(
			0,
			internal.servers.memberships.removeForUser,
			{ userId: user._id },
		);
		await ctx.scheduler.runAfter(
			0,
			internal.servers.ownership.requestDeleteForOwner,
			{ userId: user._id, cursor: null },
		);
	}
}

async function issueEpoch(ctx: MutationCtx) {
	const cursor = await ctx.db
		.query("userSyncEpochs")
		.withIndex("by_kind", (q) => q.eq("kind", "users"))
		.unique();
	const epoch = (cursor?.epoch ?? 0) + 1;
	requireEpoch(epoch);
	if (cursor === null) {
		await ctx.db.insert("userSyncEpochs", { kind: "users", epoch });
	} else {
		await ctx.db.patch("userSyncEpochs", cursor._id, { epoch });
	}
	return epoch;
}

export const issueUserEpoch = internalMutation({
	args: { clerkUserId: v.string() },
	returns: v.union(v.number(), v.null()),
	handler: async (ctx, { clerkUserId }) => {
		const sync = await getUserSync(ctx, clerkUserId);
		return sync?.status === "removed" ? null : await issueEpoch(ctx);
	},
});

export const issueListEpoch = internalMutation({
	args: {},
	returns: v.number(),
	handler: async (ctx) => await issueEpoch(ctx),
});

export const store = internalMutation({
	args: { users: v.array(userFields), epoch: v.number() },
	returns: v.null(),
	handler: async (ctx, { users, epoch }) => {
		await storeUsers(ctx, users, epoch);
		return null;
	},
});

export const remove = internalMutation({
	args: { clerkUserIds: v.array(v.string()), epoch: v.number() },
	returns: v.null(),
	handler: async (ctx, { clerkUserIds, epoch }) => {
		await removeUsers(ctx, clerkUserIds, epoch);
		return null;
	},
});
