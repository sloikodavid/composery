import { defineTable } from "convex/server";
import { v } from "convex/values";

export const serverPermissions = v.object({
	rename: v.boolean(),
	power: v.boolean(),
	manageMembers: v.boolean(),
	manageSsh: v.boolean(),
	delete: v.boolean(),
});

export const serverTables = {
	serverQuotas: defineTable({
		/** Absent is the whole deployment's server quota. */
		userId: v.optional(v.id("users")),
		limit: v.number(),
		used: v.number(),
	}).index("by_user_id", ["userId"]),

	servers: defineTable({
		name: v.string(),
		ownerId: v.id("users"),
	}).index("by_owner_id", ["ownerId"]),

	serverNames: defineTable({
		name: v.string(),
		serverId: v.id("servers"),
	}).index("by_name", ["name"]),

	serverMemberships: defineTable({
		serverId: v.id("servers"),
		userId: v.id("users"),
		permissions: serverPermissions,
	})
		.index("by_server_id_and_user_id", ["serverId", "userId"])
		.index("by_user_id", ["userId"]),
};
