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
	requireCapability,
	upsertUser
} from "./authorization";
import { capabilitiesForRole } from "./roles";

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

export const canAccessStaffConsole = query({
	args: {},
	handler: async (ctx) => {
		try {
			await requireCapability(ctx, "staff_console");
			return true;
		} catch {
			return false;
		}
	}
});

export const currentUserCapabilities = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		const user = await ctx.db
			.query("users")
			.withIndex("clerk_user_id", (query) =>
				query.eq("clerk_user_id", identity.subject)
			)
			.first();
		if (!user || user.suspended) return [];
		return capabilitiesForRole(user.role);
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
