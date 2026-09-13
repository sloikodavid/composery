import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const userFields = v.object({
	clerkUserId: v.string(),
	username: v.string(),
	email: v.string(),
	imageUrl: v.string(),
});

export const serverRole = v.union(
	v.literal("owner"),
	v.literal("write"),
	v.literal("read"),
);

export const memberRole = v.union(v.literal("write"), v.literal("read"));

export default defineSchema({
	users: defineTable(userFields)
		.index("by_clerk_user_id", ["clerkUserId"])
		.index("by_username", ["username"]),

	servers: defineTable({
		slug: v.string(),
	}),

	// Every slug a server has ever used. Rows stay after a rename or deletion, so a slug is never reused.
	serverSlugs: defineTable({
		slug: v.string(),
		serverId: v.id("servers"),
	}).index("by_slug", ["slug"]),

	serverMembers: defineTable({
		serverId: v.id("servers"),
		userId: v.id("users"),
		role: serverRole,
	})
		.index("by_server_id_and_user_id", ["serverId", "userId"])
		.index("by_user_id", ["userId"]),
});
