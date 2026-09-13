import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const userFields = v.object({
	clerkUserId: v.string(),
	username: v.string(),
	email: v.string(),
	imageUrl: v.string(),
});

export default defineSchema({
	users: defineTable(userFields).index("by_clerk_user_id", ["clerkUserId"]),
});
