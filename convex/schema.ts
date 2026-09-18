import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { allocationTables } from "./allocations/schema";
import { serverTables } from "./servers/schema";
import { sshTables } from "./ssh/schema";

export const userFields = v.object({
	clerkUserId: v.string(),
	/**
	 * How one person finds another to share a server with them. Clerk makes it optional and lets it
	 * change, so it is a way to look somebody up and never who holds a grant: that is the user ID.
	 */
	email: v.optional(v.string()),
	// Clerk does not promise this either, and nothing here depends on it, so it is what Clerk gave
	// rather than something invented to fill the shape.
	imageUrl: v.optional(v.string()),
});

export const quotaKind = v.literal("server");

export default defineSchema({
	users: defineTable(userFields)
		.index("by_clerk_user_id", ["clerkUserId"])
		.index("by_email", ["email"]),

	userQuotas: defineTable({
		userId: v.id("users"),
		kind: quotaKind,
		limit: v.number(),
		used: v.number(),
	}).index("by_user_id_and_kind", ["userId", "kind"]),

	deploymentQuotas: defineTable({
		kind: quotaKind,
		limit: v.number(),
		used: v.number(),
	}).index("by_kind", ["kind"]),

	...serverTables,
	...allocationTables,
	...sshTables,
});
