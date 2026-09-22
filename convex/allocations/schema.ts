import { defineTable } from "convex/server";
import { type Infer, v } from "convex/values";
import { hetznerCloudTables } from "./hetzner_cloud/schema";
import { failureClass, isStuck } from "./retries";

export const allocationFailure = v.object({
	since: v.number(),
	code: v.string(),
	class: failureClass,
	count: v.number(),
});

export function getAllocationStuck(
	failure: Infer<typeof allocationFailure> | undefined,
) {
	return failure !== undefined && isStuck(failure.class, failure.count)
		? { since: failure.since, code: failure.code, class: failure.class }
		: null;
}

export function isAllocationDeleting(allocation: {
	status: Infer<typeof allocationStatus>;
}) {
	return allocation.status === "deleting";
}

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

export const allocationPartStatus = v.union(
	// `mismatch` is present but not the recorded resource; `unknown` was not observed.
	v.literal("ok"),
	v.literal("missing"),
	v.literal("mismatch"),
	v.literal("unknown"),
);

export type AllocationPartStatus = Infer<typeof allocationPartStatus>;

export const allocationParts = v.object({
	server: allocationPartStatus,
	addresses: allocationPartStatus,
	firewall: allocationPartStatus,
});

/** Deletion completes by removing the allocation in the same transaction. */
export const allocationStatus = v.union(
	v.literal("creating"),
	v.literal("running"),
	v.literal("stopped"),
	v.literal("deleting"),
);

export const allocationTables = {
	serverAllocations: defineTable({
		serverId: v.id("servers"),
		operationId: v.id("serverOperations"),
		status: allocationStatus,
		observedAt: v.optional(v.number()),
		parts: allocationParts,
		/** Last failure; the worker continues to retry it. */
		failure: v.optional(allocationFailure),
		ipv4: v.optional(v.string()),
		// IPv6 is a provider-assigned network, not the server's address.
		ipv6: v.optional(v.string()),
		// Learned from the server, never derived from the network.
		ipv6Address: v.optional(v.string()),
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
