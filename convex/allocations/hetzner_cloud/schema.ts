import { defineTable } from "convex/server";
import { v } from "convex/values";

/** Whether a Hetzner resource exists. `uncertain` means that a create request can still take effect. */
export const hetznerCloudResourceStatus = v.union(
	v.object({ status: v.literal("pending") }),
	v.object({ status: v.literal("uncertain") }),
	v.object({ status: v.literal("present"), id: v.number() }),
	v.object({ status: v.literal("absent"), id: v.optional(v.number()) }),
);

export const hetznerCloudResourceKind = v.union(
	v.literal("ipv4"),
	v.literal("ipv6"),
	v.literal("server"),
);

export const hetznerCloudQueue = v.union(
	v.literal("work"),
	v.literal("cleanup"),
);

/**
 * What Hetzner last said is left of a project's requests, from the headers every reply carries.
 * `resetAt` is when all of `limit` is back; Hetzner gives it back gradually until then.
 */
export const hetznerCloudBudget = v.object({
	limit: v.number(),
	remaining: v.number(),
	resetAt: v.number(),
	observedAt: v.number(),
});

/** What one action sent to Hetzner, and what the last reply said is left. */
export const hetznerCloudUsage = v.object({
	requests: v.number(),
	budget: v.optional(hetznerCloudBudget),
});

export const hetznerCloudSpec = v.object({
	location: v.string(),
	imageId: v.number(),
	serverType: v.string(),
});

export const hetznerCloudCollection = v.union(
	v.literal("servers"),
	v.literal("primary_ips"),
);

export const hetznerCloudFindingReason = v.union(
	v.literal("unknown_allocation"),
	v.literal("unexpected_resource"),
);

export const hetznerCloudTables = {
	hetznerCloudAllocations: defineTable({
		allocationId: v.id("serverAllocations"),
		controllerId: v.string(),
		firewallId: v.optional(v.number()),
		locations: v.array(v.string()),
		image: v.string(),
		serverType: v.string(),
		spec: v.optional(hetznerCloudSpec),
		resources: v.object({
			ipv4: hetznerCloudResourceStatus,
			ipv6: hetznerCloudResourceStatus,
			server: hetznerCloudResourceStatus,
		}),
		queue: hetznerCloudQueue,
		dueAt: v.number(),
		leaseExpiresAt: v.number(),
		epoch: v.number(),
		failures: v.number(),
		action: v.optional(v.object({ id: v.number(), startedAt: v.number() })),
		error: v.optional(v.string()),
		hetznerErrorCode: v.optional(v.string()),
	})
		.index("by_allocation_id", ["allocationId"])
		.index("by_queue_and_due_at", ["queue", "dueAt"]),

	hetznerCloudScans: defineTable({
		controllerId: v.string(),
		collection: hetznerCloudCollection,
		page: v.number(),
		dueAt: v.number(),
		epoch: v.number(),
		error: v.optional(v.string()),
	}).index("by_controller_id", ["controllerId"]),

	// One row for each project, because the budget belongs to the token and not to any one run.
	hetznerCloudBudgets: defineTable({
		controllerId: v.string(),
		...hetznerCloudBudget.fields,
	}).index("by_controller_id", ["controllerId"]),

	// Evidence for admin review. The controller never deletes a resource because of a finding.
	hetznerCloudFindings: defineTable({
		controllerId: v.string(),
		collection: hetznerCloudCollection,
		resourceId: v.number(),
		reason: hetznerCloudFindingReason,
		observedAt: v.number(),
		resolved: v.boolean(),
	})
		.index("by_controller_id_and_collection_and_resource_id", [
			"controllerId",
			"collection",
			"resourceId",
		])
		.index("by_resolved", ["resolved"]),
};
