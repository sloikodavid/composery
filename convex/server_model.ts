import { v } from "convex/values";

export const resourceState = v.union(
	v.object({ phase: v.literal("pending") }),
	v.object({ phase: v.literal("uncertain") }),
	v.object({ phase: v.literal("present"), id: v.number() }),
	v.object({ phase: v.literal("absent"), id: v.optional(v.number()) }),
);
export const resourceKind = v.union(
	v.literal("ipv4"),
	v.literal("ipv6"),
	v.literal("server"),
);
export const allocationStatus = v.union(
	v.literal("allocating"),
	v.literal("running"),
	v.literal("off"),
	v.literal("deleting"),
	v.literal("deleted"),
	v.literal("blocked"),
	v.literal("missing"),
);
export const allocationFields = v.object({
	serverId: v.id("servers"),
	grantId: v.id("serverGrants"),
	backend: v.literal("hetznerCloud"),
	controllerId: v.string(),
	firewallId: v.number(),
	locations: v.array(v.string()),
	image: v.string(),
	spec: v.optional(
		v.object({
			location: v.string(),
			imageId: v.number(),
			serverType: v.string(),
		}),
	),
	resources: v.object({
		ipv4: resourceState,
		ipv6: resourceState,
		server: resourceState,
	}),
	status: allocationStatus,
	deleteRequested: v.boolean(),
	operationId: v.id("serverOperations"),
	dueAt: v.number(),
	leaseUntil: v.number(),
	epoch: v.number(),
	failures: v.number(),
	error: v.optional(v.string()),
	observedAt: v.optional(v.number()),
	ipv4: v.optional(v.string()),
	ipv6: v.optional(v.string()),
	action: v.optional(v.object({ id: v.number(), startedAt: v.number() })),
});
export const operationFields = v.object({
	serverId: v.id("servers"),
	requesterId: v.optional(v.id("users")),
	requestId: v.string(),
	name: v.optional(v.string()),
	kind: v.union(
		v.literal("create"),
		v.literal("start"),
		v.literal("stop"),
		v.literal("forceStop"),
		v.literal("delete"),
	),
	state: v.union(
		v.literal("pending"),
		v.literal("succeeded"),
		v.literal("blocked"),
		v.literal("superseded"),
	),
	error: v.optional(v.string()),
	finishedAt: v.optional(v.number()),
	deadlineAt: v.optional(v.number()),
});
