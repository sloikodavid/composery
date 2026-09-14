import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	type QueryCtx,
	query,
} from "./_generated/server";
import schema, { userFields } from "./schema";

async function getUserByClerkId(ctx: QueryCtx, clerkUserId: string) {
	return await ctx.db
		.query("users")
		.withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId))
		.unique();
}

async function getDisabledUser(ctx: QueryCtx, userId: Id<"users">) {
	return await ctx.db
		.query("disabledUsers")
		.withIndex("by_user_id", (q) => q.eq("userId", userId))
		.unique();
}

export async function isUserDisabled(ctx: QueryCtx, userId: Id<"users">) {
	return (await getDisabledUser(ctx, userId)) !== null;
}

export async function getCurrentUser(ctx: QueryCtx) {
	const identity = await ctx.auth.getUserIdentity();
	if (identity === null) {
		return null;
	}
	const user = await getUserByClerkId(ctx, identity.subject);
	if (user === null || (await isUserDisabled(ctx, user._id))) {
		return null;
	}
	return user;
}

export async function requireUser(ctx: QueryCtx) {
	const user = await getCurrentUser(ctx);
	if (user === null) {
		throw new ConvexError({ message: "Sign in to continue." });
	}
	return user;
}

export const getCurrent = query({
	args: {},
	returns: v.union(schema.doc("users"), v.null()),
	handler: async (ctx) => await getCurrentUser(ctx),
});

export const isEnabled = internalQuery({
	args: { clerkUserId: v.string() },
	returns: v.boolean(),
	handler: async (ctx, { clerkUserId }) => {
		const user = await getUserByClerkId(ctx, clerkUserId);
		return user !== null && !(await isUserDisabled(ctx, user._id));
	},
});

export const listClerkIds = internalQuery({
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
			const existing = await getUserByClerkId(ctx, fields.clerkUserId);
			if (existing === null) {
				await ctx.db.insert("users", fields);
				continue;
			}
			await ctx.db.patch("users", existing._id, fields);
			const disabledUser = await getDisabledUser(ctx, existing._id);
			if (disabledUser !== null) {
				await ctx.db.delete("disabledUsers", disabledUser._id);
			}
		}
		return null;
	},
});

// Missing profile fields disable app access without deleting owned infrastructure.
export const disable = internalMutation({
	args: { clerkUserIds: v.array(v.string()) },
	returns: v.null(),
	handler: async (ctx, { clerkUserIds }) => {
		for (const clerkUserId of clerkUserIds) {
			const user = await getUserByClerkId(ctx, clerkUserId);
			if (user !== null && !(await isUserDisabled(ctx, user._id))) {
				await ctx.db.insert("disabledUsers", { userId: user._id });
			}
		}
		return null;
	},
});

// Deletes the users. JavaScript reserves `delete`, so the function is named `remove`.
export const remove = internalMutation({
	args: { clerkUserIds: v.array(v.string()) },
	returns: v.null(),
	handler: async (ctx, { clerkUserIds }) => {
		for (const clerkUserId of clerkUserIds) {
			const user = await getUserByClerkId(ctx, clerkUserId);
			if (user === null) {
				continue;
			}
			const disabledUser = await getDisabledUser(ctx, user._id);
			if (disabledUser !== null) {
				await ctx.db.delete("disabledUsers", disabledUser._id);
			}
			await ctx.db.delete("users", user._id);
			await ctx.scheduler.runAfter(
				0,
				internal.servers.memberships.removeForUser,
				{ userId: user._id },
			);
		}
		return null;
	},
});
