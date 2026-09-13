import type { User } from "@clerk/backend";
import { createClerkClient } from "@clerk/backend";
import { isClerkAPIResponseError } from "@clerk/backend/errors";
import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import { ConvexError, type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import {
	type ActionCtx,
	action,
	env,
	internalAction,
	internalMutation,
	internalQuery,
	type QueryCtx,
	query,
} from "./_generated/server";
import { rateLimiter, tooManyAttemptsMessage } from "./limits";
import schema, { userFields } from "./schema";

const CLERK_PAGE_SIZE = 100;

export async function getCurrentUser(ctx: QueryCtx) {
	const identity = await ctx.auth.getUserIdentity();
	if (identity === null) {
		return null;
	}
	const user = await ctx.db
		.query("users")
		.withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", identity.subject))
		.unique();
	if (!user) return null;
	const access = await ctx.db
		.query("userAccess")
		.withIndex("by_user_id", (q) => q.eq("userId", user._id))
		.unique();
	return access?.disabled ? null : user;
}

function clerkClient() {
	return createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
}

// Returns null until the Clerk account has every field that sign-up requires.
function toUserFields(user: User): Infer<typeof userFields> | null {
	const email = user.primaryEmailAddress?.emailAddress;
	if (email === undefined || user.username === null) {
		return null;
	}
	return {
		clerkUserId: user.id,
		username: user.username,
		email,
		imageUrl: user.imageUrl,
	};
}

async function storeFromClerk(ctx: ActionCtx, users: User[]) {
	const complete: Infer<typeof userFields>[] = [];
	const incomplete: string[] = [];
	for (const user of users) {
		const fields = toUserFields(user);
		if (fields === null) {
			incomplete.push(user.id);
		} else {
			complete.push(fields);
		}
	}
	if (complete.length > 0) {
		await ctx.runMutation(internal.users.store, { users: complete });
	}
	if (incomplete.length > 0) {
		await ctx.runMutation(internal.users.disable, { clerkUserIds: incomplete });
	}
}

// Reads the current state from Clerk, so the order in which events arrive does not matter.
async function syncUser(ctx: ActionCtx, clerkUserId: string) {
	let user: User;
	try {
		user = await clerkClient().users.getUser(clerkUserId);
	} catch (error) {
		if (isClerkAPIResponseError(error) && error.status === 404) {
			await ctx.runMutation(internal.users.remove, {
				clerkUserIds: [clerkUserId],
			});
			return;
		}
		throw error;
	}
	await storeFromClerk(ctx, [user]);
}

export const current = query({
	args: {},
	returns: v.union(schema.doc("users"), v.null()),
	handler: async (ctx) => await getCurrentUser(ctx),
});

export const syncCurrentUser = action({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (identity === null) {
			throw new ConvexError({ message: "Sign in to continue." });
		}
		const status = await rateLimiter.limit(ctx, "userSync", {
			key: identity.subject,
		});
		if (!status.ok) {
			throw new ConvexError({
				message: tooManyAttemptsMessage(status.retryAfter),
			});
		}
		const stored = await ctx.runQuery(internal.users.isStored, {
			clerkUserId: identity.subject,
		});
		if (!stored) {
			await syncUser(ctx, identity.subject);
		}
		return null;
	},
});

export const syncFromClerk = internalAction({
	args: { clerkUserId: v.string() },
	returns: v.null(),
	handler: async (ctx, { clerkUserId }) => {
		await syncUser(ctx, clerkUserId);
		return null;
	},
});

export const reconcile = internalAction({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const clerk = clerkClient();

		for (let offset = 0; ; offset += CLERK_PAGE_SIZE) {
			const { data } = await clerk.users.getUserList({
				limit: CLERK_PAGE_SIZE,
				offset,
				orderBy: "+created_at",
			});
			await storeFromClerk(ctx, data);
			if (data.length < CLERK_PAGE_SIZE) {
				break;
			}
		}

		let cursor: string | null = null;
		for (;;) {
			const page: { page: string[]; isDone: boolean; continueCursor: string } =
				await ctx.runQuery(internal.users.listClerkUserIds, {
					paginationOpts: { numItems: CLERK_PAGE_SIZE, cursor },
				});
			if (page.page.length > 0) {
				const { data } = await clerk.users.getUserList({
					userId: page.page,
					limit: page.page.length,
				});
				const existing = new Set(data.map((user) => user.id));
				const missing = page.page.filter((id) => !existing.has(id));
				if (missing.length > 0) {
					await ctx.runMutation(internal.users.remove, {
						clerkUserIds: missing,
					});
				}
			}
			if (page.isDone) {
				break;
			}
			cursor = page.continueCursor;
		}
		return null;
	},
});

export const isStored = internalQuery({
	args: { clerkUserId: v.string() },
	returns: v.boolean(),
	handler: async (ctx, { clerkUserId }) => {
		const user = await ctx.db
			.query("users")
			.withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId))
			.unique();
		if (!user) return false;
		const access = await ctx.db
			.query("userAccess")
			.withIndex("by_user_id", (q) => q.eq("userId", user._id))
			.unique();
		return !access?.disabled;
	},
});

export const listClerkUserIds = internalQuery({
	args: { paginationOpts: paginationOptsValidator },
	returns: paginationResultValidator(v.string()),
	handler: async (ctx, { paginationOpts }) => {
		const result = await ctx.db.query("users").paginate(paginationOpts);
		return { ...result, page: result.page.map((user) => user.clerkUserId) };
	},
});

export const store = internalMutation({
	args: { users: v.array(userFields) },
	returns: v.null(),
	handler: async (ctx, { users }) => {
		for (const fields of users) {
			const existing = await ctx.db
				.query("users")
				.withIndex("by_clerk_user_id", (q) =>
					q.eq("clerkUserId", fields.clerkUserId),
				)
				.unique();
			if (existing === null) {
				await ctx.db.insert("users", fields);
			} else {
				await ctx.db.patch("users", existing._id, fields);
				const access = await ctx.db
					.query("userAccess")
					.withIndex("by_user_id", (q) => q.eq("userId", existing._id))
					.unique();
				if (access) await ctx.db.delete("userAccess", access._id);
			}
		}
		return null;
	},
});

// Missing profile fields suspend application access without deleting owned infrastructure.
export const disable = internalMutation({
	args: { clerkUserIds: v.array(v.string()) },
	returns: v.null(),
	handler: async (ctx, { clerkUserIds }) => {
		for (const clerkUserId of clerkUserIds) {
			const user = await ctx.db
				.query("users")
				.withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId))
				.unique();
			if (!user) continue;
			const access = await ctx.db
				.query("userAccess")
				.withIndex("by_user_id", (q) => q.eq("userId", user._id))
				.unique();
			if (!access)
				await ctx.db.insert("userAccess", { userId: user._id, disabled: true });
		}
		return null;
	},
});

export const remove = internalMutation({
	args: { clerkUserIds: v.array(v.string()) },
	returns: v.null(),
	handler: async (ctx, { clerkUserIds }) => {
		for (const clerkUserId of clerkUserIds) {
			const existing = await ctx.db
				.query("users")
				.withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId))
				.unique();
			if (existing !== null) {
				const access = await ctx.db
					.query("userAccess")
					.withIndex("by_user_id", (q) => q.eq("userId", existing._id))
					.unique();
				if (access) await ctx.db.delete("userAccess", access._id);
				await ctx.db.delete("users", existing._id);
				await ctx.scheduler.runAfter(
					0,
					internal.servers.removeUserMemberships,
					{ userId: existing._id },
				);
			}
		}
		return null;
	},
});
