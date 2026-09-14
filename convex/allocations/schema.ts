import { defineTable } from "convex/server";
import { v } from "convex/values";
import { hetznerCloudTables } from "./hetzner_cloud/schema";

export const allocationBackend = v.literal("hetznerCloud");

export const powerOperationKind = v.union(
	v.literal("start"),
	v.literal("stop"),
	v.literal("forceStop"),
);

const operationKind = v.union(
	v.literal("create"),
	powerOperationKind,
	v.literal("delete"),
);

const operationStatus = v.union(
	v.literal("pending"),
	v.literal("succeeded"),
	v.literal("blocked"),
	v.literal("superseded"),
);

export const allocationStatus = v.union(
	v.literal("creating"),
	v.literal("running"),
	v.literal("stopped"),
	v.literal("deleting"),
	v.literal("deleted"),
	v.literal("blocked"),
	v.literal("missing"),
);

export const allocationTables = {
	// Operator-controlled capacity before billing exists.
	serverGrants: defineTable({
		userId: v.id("users"),
		limit: v.number(),
		used: v.number(),
	}).index("by_user_id", ["userId"]),

	// Fields that code outside a backend reads. Each backend keeps its own state in its own table.
	serverAllocations: defineTable({
		serverId: v.id("servers"),
		grantId: v.id("serverGrants"),
		operationId: v.id("serverOperations"),
		backend: allocationBackend,
		status: allocationStatus,
		deleteRequested: v.boolean(),
		error: v.optional(v.string()),
		observedAt: v.optional(v.number()),
		location: v.optional(v.string()),
		ipv4: v.optional(v.string()),
		ipv6: v.optional(v.string()),
	}).index("by_server_id", ["serverId"]),

	serverOperations: defineTable({
		serverId: v.id("servers"),
		requesterId: v.optional(v.id("users")),
		requestId: v.string(),
		name: v.optional(v.string()),
		kind: operationKind,
		status: operationStatus,
		error: v.optional(v.string()),
		finishedAt: v.optional(v.number()),
		deadlineAt: v.optional(v.number()),
	})
		.index("by_requester_id_and_request_id", ["requesterId", "requestId"])
		.index("by_server_id", ["serverId"]),

	...hetznerCloudTables,
};
