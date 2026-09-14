import { defineTable } from "convex/server";
import { v } from "convex/values";

/** Platform authority only. These permissions do not restrict direct SSH sessions. */
export const serverPermissions = v.object({
	rename: v.boolean(),
	power: v.boolean(),
	manageMembers: v.boolean(),
	manageSsh: v.boolean(),
	delete: v.boolean(),
});

export const serverTables = {
	// The name follows DNS label rules because it can become a subdomain.
	servers: defineTable({
		name: v.string(),
		ownerId: v.id("users"),
	}),

	// Claims stay after a rename or deletion. Only the same server can use a claimed name again.
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
