import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { allocationFields, operationFields } from "./server_model";
import { serverPermissions } from "./server_permissions";

export const userFields = v.object({
	clerkUserId: v.string(),
	username: v.string(),
	email: v.string(),
	imageUrl: v.string(),
});

export default defineSchema({
	serverSshAccess: defineTable({
		allocationId: v.id("serverAllocations"),
		publicKey: v.string(),
		sealedCredential: v.string(),
		bootstrapDigest: v.string(),
		bootstrapExpiresAt: v.number(),
		hostKey: v.optional(v.string()),
	}).index("by_allocation_id", ["allocationId"]),
	users: defineTable(userFields)
		.index("by_clerk_user_id", ["clerkUserId"])
		.index("by_username", ["username"]),
	userAccess: defineTable({
		userId: v.id("users"),
		disabled: v.boolean(),
	}).index("by_user_id", ["userId"]),
	serverGrants: defineTable({
		userId: v.id("users"),
		limit: v.number(),
		used: v.number(),
	}).index("by_user_id", ["userId"]),
	serverAllocations: defineTable(allocationFields)
		.index("by_server_id", ["serverId"])
		.index("by_delete_requested_and_due_at", ["deleteRequested", "dueAt"]),
	serverOperations: defineTable(operationFields)
		.index("by_requester_id_and_request_id", ["requesterId", "requestId"])
		.index("by_server_id", ["serverId"]),
	serverInventory: defineTable({
		controllerId: v.string(),
		kind: v.union(v.literal("servers"), v.literal("primary_ips")),
		page: v.number(),
		dueAt: v.number(),
		epoch: v.number(),
		error: v.optional(v.string()),
	}).index("by_controller_id", ["controllerId"]),
	serverFindings: defineTable({
		controllerId: v.string(),
		kind: v.string(),
		providerId: v.number(),
		reason: v.string(),
		observedAt: v.number(),
		resolved: v.boolean(),
	})
		.index("by_controller_id_and_kind_and_provider_id", [
			"controllerId",
			"kind",
			"providerId",
		])
		.index("by_resolved", ["resolved"]),

	// The name follows DNS label rules because it can become a subdomain.
	servers: defineTable({
		name: v.string(),
		ownerId: v.id("users"),
	}),

	// Claims stay after a rename or deletion. Only the same server can reuse a name.
	serverNames: defineTable({
		name: v.string(),
		serverId: v.id("servers"),
	}).index("by_name", ["name"]),

	serverMembers: defineTable({
		serverId: v.id("servers"),
		userId: v.id("users"),
		permissions: serverPermissions,
	})
		.index("by_server_id_and_user_id", ["serverId", "userId"])
		.index("by_user_id", ["userId"]),
});
