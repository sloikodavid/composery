import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { allocationTables } from "./allocations/schema";
import { serverTables } from "./servers/schema";
import { sshTables } from "./ssh/schema";

export const userFields = v.object({
	clerkUserId: v.string(),
	email: v.optional(v.string()),
	imageUrl: v.optional(v.string()),
});

export const quotaKind = v.literal("server");

const userSyncStatus = v.union(v.literal("active"), v.literal("removed"));

export default defineSchema({
	users: defineTable(userFields)
		.index("by_clerk_user_id", ["clerkUserId"])
		.index("by_email", ["email"]),

	/** A tombstone and epoch fence keep an older Clerk read from restoring a removed user. */
	userSyncs: defineTable({
		clerkUserId: v.string(),
		/** The epoch of the last result committed for this user. */
		epoch: v.number(),
		status: userSyncStatus,
	}).index("by_clerk_user_id", ["clerkUserId"]),

	userSyncEpochs: defineTable({
		kind: v.literal("users"),
		epoch: v.number(),
	}).index("by_kind", ["kind"]),

	quotas: defineTable({
		/** Absent is the whole deployment's quota for this kind. */
		userId: v.optional(v.id("users")),
		kind: quotaKind,
		limit: v.number(),
		used: v.number(),
	}).index("by_user_id_and_kind", ["userId", "kind"]),

	/** Fences a recount against the held rows, and their owners, changing under it. */
	quotaEpochs: defineTable({
		kind: quotaKind,
		epoch: v.number(),
	}).index("by_kind", ["kind"]),

	...serverTables,
	...allocationTables,
	...sshTables,
});
