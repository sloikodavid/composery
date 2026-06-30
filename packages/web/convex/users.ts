import { v } from "convex/values";
import {
	internalMutation,
	internalQuery,
	mutation,
	query
} from "./_generated/server";
import {
	ensureUserRecord,
	publicUser,
	requireStaff,
	upsertUser
} from "./authorization";

export const ensureCurrentUser = mutation({
	args: {},
	handler: async (ctx) => {
		return publicUser(await ensureUserRecord(ctx));
	}
});

export const ensureUserForIdentity = internalMutation({
	args: {
		clerkUserId: v.string(),
		email: v.string()
	},
	handler: async (ctx, args) => {
		return await upsertUser(ctx, args.clerkUserId, args.email);
	}
});

export const isCurrentUserStaff = query({
	args: {},
	handler: async (ctx) => {
		try {
			await requireStaff(ctx);
			return true;
		} catch {
			return false;
		}
	}
});

export const activeUserByClerkId = internalQuery({
	args: {
		clerkUserId: v.string()
	},
	handler: async (ctx, args) => {
		const user = await ctx.db
			.query("users")
			.withIndex("clerk_user_id", (query) =>
				query.eq("clerk_user_id", args.clerkUserId)
			)
			.first();

		if (!user || user.suspended) return null;
		return user;
	}
});
