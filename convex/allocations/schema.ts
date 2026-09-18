import { defineTable } from "convex/server";
import { v } from "convex/values";
import { hetznerCloudTables } from "./hetzner_cloud/schema";
import { failureClass } from "./retries";

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
	// Nothing more will be done about it: its own deadline passed.
	v.literal("blocked"),
	v.literal("superseded"),
);

/**
 * Each part of an allocation, in Composery's words rather than a provider's, so that a later
 * backend with different resources says the same things about them.
 */
export const allocationPartState = v.union(
	// Last seen as it should be.
	v.literal("ok"),
	// Last seen to be gone.
	v.literal("missing"),
	// There, but not what this allocation recorded: somebody changed it somewhere else.
	v.literal("mismatch"),
	// Never seen, or not seen since something stopped us looking.
	v.literal("unknown"),
);

export const allocationParts = v.object({
	/** The computer itself. */
	server: allocationPartState,
	/** Its addresses, which a customer's own things point at. */
	addresses: allocationPartState,
	/** The rules in front of it. */
	firewall: allocationPartState,
});

/**
 * Where the allocation is in its life. What is wrong with it, if anything, is a separate thing:
 * one word for both made a lost management key stop a power command that would have worked.
 */
export const allocationStatus = v.union(
	v.literal("creating"),
	v.literal("running"),
	v.literal("stopped"),
	v.literal("deleting"),
	v.literal("deleted"),
);

export const allocationTables = {
	serverAllocations: defineTable({
		serverId: v.id("servers"),
		operationId: v.id("serverOperations"),
		backend: allocationBackend,
		status: allocationStatus,
		deleteRequested: v.boolean(),
		observedAt: v.optional(v.number()),
		parts: allocationParts,
		/**
		 * Why the allocation is not moving, when it is not. It is still picked up again: this says
		 * what the last attempt ran into, not that anybody has given up.
		 */
		stuck: v.optional(
			v.object({ since: v.number(), code: v.string(), class: failureClass }),
		),
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
