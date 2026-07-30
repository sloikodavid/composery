import { v } from "convex/values";
import {
	internalMutation,
	internalQuery,
	mutation,
	query
} from "./_generated/server";
import {
	ensureUserRecord,
	getUserByClerkId,
	publicUser,
	upsertUser
} from "./authorization";
import { userHasCapability } from "./roles";

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

// Whether to offer the console at all - the nav link and the page's own server
// guard ask this and nothing else. It answers `false` rather than throwing,
// because "you are an ordinary customer" is the expected case here, not a
// failure; every backend endpoint behind the console still checks the specific
// capability it needs, which is where the boundary actually is.
export const canAccessStaffConsole = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return false;
		return userHasCapability(
			await getUserByClerkId(ctx, identity.subject),
			"staff_console"
		);
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
