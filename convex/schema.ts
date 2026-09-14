import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { allocationTables } from "./allocations/schema";
import { serverTables } from "./servers/schema";
import { sshTables } from "./ssh/schema";

export const userFields = v.object({
	clerkUserId: v.string(),
	username: v.string(),
	email: v.string(),
	imageUrl: v.string(),
});

export default defineSchema({
	users: defineTable(userFields)
		.index("by_clerk_user_id", ["clerkUserId"])
		.index("by_username", ["username"]),

	// A row disables app access until the Clerk account has every required field.
	disabledUsers: defineTable({ userId: v.id("users") }).index("by_user_id", [
		"userId",
	]),

	...serverTables,
	...allocationTables,
	...sshTables,
});
