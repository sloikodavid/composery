import { expect, test } from "bun:test";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
	getHetznerCloudTransition,
	idleAllocationDueAt,
} from "../../../../convex/allocations/hetzner_cloud/transitions";

function createContext(): Parameters<typeof getHetznerCloudTransition>[0] {
	const serverId = "server" as Id<"servers">;
	const allocationId = "allocation" as Id<"serverAllocations">;
	const operationId = "operation" as Id<"serverOperations">;
	return {
		now: 1000,
		allocation: {
			_id: allocationId,
			_creationTime: 0,
			serverId,
			operationId,
			status: "creating",
			parts: { server: "unknown", addresses: "unknown", firewall: "unknown" },
		},
		provider: {
			_id: "provider" as Id<"hetznerCloudAllocations">,
			_creationTime: 0,
			allocationId,
			controllerId: "test",
			image: "image",
			locations: ["location"],
			serverType: "type",
			spec: { imageId: 1, location: "location", serverType: "type" },
			firewallId: 1,
			resources: {
				ipv4: { status: "present", id: 1 },
				ipv6: { status: "present", id: 2 },
				server: { status: "uncertain" },
			},
			queue: "work",
			dueAt: 2000,
			leaseExpiresAt: 2000,
			epoch: 1,
		},
		operation: {
			_id: operationId,
			_creationTime: 0,
			serverId,
			kind: "create",
			status: "pending",
			requestId: "request",
		},
	};
}

test("a replaced worker can preserve a resource but cannot block or delay deletion", () => {
	const actionId = 4;
	const immediateRetryLimitMs = 10_000;
	const context = createContext();
	context.allocation.operationId = "deletion" as Id<"serverOperations">;
	context.allocation.status = "deleting";
	const found = getHetznerCloudTransition(context, {
		kind: "resourceFound",
		resource: "server",
		id: 3,
		actionId,
	});
	expect(found.provider.resources?.server).toEqual({
		status: "present",
		id: 3,
	});
	expect(found.provider.action?.id).toBe(actionId);
	expect(found.operation).toBeUndefined();
	expect(found.allocation.status).toBeUndefined();
	const failed = getHetznerCloudTransition(context, {
		kind: "deadlinePassed",
		failure: {
			error: "late_failure",
			class: "invalid",
			retryAfterMs: 3_600_000,
		},
	});
	expect(failed.allocation).toEqual({});
	expect(failed.operation).toBeUndefined();
	expect(failed.provider.dueAt).toBeLessThan(
		context.now + immediateRetryLimitMs,
	);
});

test("only a confirmed create rejection permits the resource request to be sent again", () => {
	const context = createContext();
	const uncertain = getHetznerCloudTransition(context, {
		kind: "failed",
		failure: { error: "lost_reply", class: "indeterminate" },
	});
	expect(uncertain.provider.resources).toBeUndefined();
	const rejected = getHetznerCloudTransition(context, {
		kind: "createRejected",
		resource: "server",
		failure: { error: "capacity_unavailable", class: "waiting" },
	});
	expect(rejected.provider.resources?.server).toEqual({ status: "pending" });
	expect(rejected.allocation.failure?.count).toBe(1);
});

test("a later observation cannot turn an expired operation into a successful one", () => {
	const context = createContext();
	context.operation.kind = "start";
	context.operation.status = "blocked";
	context.allocation.failure = {
		since: 500,
		count: 1,
		code: "power_change_timed_out",
		class: "invalid",
	};
	const maintenance = getHetznerCloudTransition(context, { kind: "waiting" });
	expect(maintenance.allocation).not.toHaveProperty("failure");
	const observed = getHetznerCloudTransition(context, {
		kind: "observed",
		server: {
			id: 3,
			status: "running",
			location: "location",
			serverType: "type",
			ipv4: { id: 1, address: "192.0.2.1" },
			ipv6: { id: 2, address: "2001:db8::/64" },
			firewalls: [{ id: 1, isApplied: true }],
		},
	});
	expect(observed.operation).toBeUndefined();
	expect(observed.allocation.failure).toEqual(context.allocation.failure);
	expect(observed.allocation.status).toBe("running");
	expect(observed.provider.dueAt).toBe(idleAllocationDueAt);
});

test("deletion needs the current deletion operation and absence of every resource", () => {
	const context = createContext();
	context.allocation.status = "deleting";
	context.operation.kind = "delete";
	expect(() => getHetznerCloudTransition(context, { kind: "deleted" })).toThrow(
		"all resources are absent",
	);
	context.provider.resources = {
		ipv4: { status: "absent" },
		ipv6: { status: "absent" },
		server: { status: "absent" },
	};
	expect(
		getHetznerCloudTransition(context, { kind: "deleted" }).operation?.status,
	).toBe("succeeded");
	context.allocation.operationId = "replacement" as Id<"serverOperations">;
	expect(() =>
		getHetznerCloudTransition(context, { kind: "deleted" }),
	).toThrow();
});
