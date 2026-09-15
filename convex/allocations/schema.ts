import { defineTable } from "convex/server";
import { v } from "convex/values";
import { hetznerCloudTables } from "./hetzner_cloud/schema";

export const allocationBackend = v.literal("hetznerCloud");

export const powerOperationKind = v.union(
	v.literal("start"),
	v.literal("stop"),
	v.literal("forceStop"),
);

export const operationKind = v.union(
	v.literal("create"),
	powerOperationKind,
	v.literal("delete"),
);

export const operationStatus = v.union(
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
	serverAllocations: defineTable({
		serverId: v.id("servers"),
		operationId: v.id("serverOperations"),
		backend: allocationBackend,
		status: allocationStatus,
		deleteRequested: v.boolean(),
		observedAt: v.optional(v.number()),
		location: v.optional(v.string()),
		ipv4: v.optional(v.string()),
		// A network in CIDR form, not one address: a backend assigns a server a range of its own.
		ipv6: v.optional(v.string()),
		// The hostname the server last reported, which the customer may have chosen themselves.
		hostname: v.optional(v.string()),
	}).index("by_server_id", ["serverId"]),

	serverOperations: defineTable({
		serverId: v.id("servers"),
		requesterId: v.optional(v.id("users")),
		requestId: v.string(),
		name: v.optional(v.string()),
		kind: operationKind,
		status: operationStatus,
		finishedAt: v.optional(v.number()),
		deadlineAt: v.optional(v.number()),
	})
		.index("by_requester_id_and_request_id", ["requesterId", "requestId"])
		.index("by_server_id", ["serverId"]),

	...hetznerCloudTables,
};
