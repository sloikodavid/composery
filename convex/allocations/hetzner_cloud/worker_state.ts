import { Workpool } from "@convex-dev/workpool";
import { type Infer, v } from "convex/values";
import { components, internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import {
	internalQuery,
	type MutationCtx,
	type QueryCtx,
} from "../../_generated/server";
import { type Failure, fail } from "../../errors";
import { internalMutation } from "../../functions";
import schema from "../../schema";
import { storeAllocationSshAccess } from "../../ssh/access_state";
import { sshTables } from "../../ssh/schema";
import type {
	allocationParts,
	allocationStatus,
	operationKind,
} from "../schema";
import { getAllocationStuck, isAllocationDeleting } from "../schema";
import type { HetznerCloudConfig } from "./api";
import {
	type HetznerCloudServer,
	observeHetznerCloudServer,
	type ServerObservation,
} from "./observation";
import { hetznerCloudOutcome } from "./outcomes";
import { chargeHetznerCloudPacing, checkHetznerCloudPacing } from "./pacing";
import {
	hetznerCloudQueue,
	hetznerCloudResourceKind,
	hetznerCloudUsage,
} from "./schema";
import {
	type AllocationPatch,
	getHetznerCloudTransition,
	idleAllocationDueAt,
} from "./transitions";

export const hetznerCloudPowerDeadlineMs = 300_000;
const leaseMs = 120_000;
const sweepBatchSize = 10;

type HetznerCloudQueue = Infer<typeof hetznerCloudQueue>;
type HetznerCloudAllocation = Doc<"hetznerCloudAllocations">;
type AllocationStatus = Infer<typeof allocationStatus>;
type OperationKind = Infer<typeof operationKind>;

function getRetryAllocationStatus(
	kind: OperationKind,
	current: AllocationStatus,
): AllocationStatus {
	switch (kind) {
		case "create":
			return "creating";
		case "delete":
			return "deleting";
		case "start":
		case "stop":
		case "forceStop":
			return current;
	}
}

const workPools: Record<HetznerCloudQueue, Workpool> = {
	cleanup: new Workpool(components.hetznerCloudCleanup, {
		maxParallelism: 1,
		retryActionsByDefault: false,
	}),
	work: new Workpool(components.hetznerCloudWork, {
		maxParallelism: 2,
		retryActionsByDefault: false,
	}),
};

export const hetznerCloudWorkPool = workPools.work;

export async function getHetznerCloudAllocation(
	ctx: QueryCtx,
	allocationId: Id<"serverAllocations">,
) {
	return await ctx.db
		.query("hetznerCloudAllocations")
		.withIndex("by_allocation_id", (q) => q.eq("allocationId", allocationId))
		.unique();
}

export const get = internalQuery({
	args: { allocationId: v.id("serverAllocations") },
	returns: v.union(schema.doc("hetznerCloudAllocations"), v.null()),
	handler: async (ctx, { allocationId }) =>
		await getHetznerCloudAllocation(ctx, allocationId),
});

async function requireHetznerCloudAllocation(
	ctx: QueryCtx,
	allocationId: Id<"serverAllocations">,
) {
	const hetznerCloudAllocation = await getHetznerCloudAllocation(
		ctx,
		allocationId,
	);
	if (hetznerCloudAllocation === null) {
		throw new Error("The Hetzner Cloud allocation is missing.");
	}
	return hetznerCloudAllocation;
}

async function enqueue(
	ctx: MutationCtx,
	hetznerCloudAllocation: HetznerCloudAllocation,
) {
	await workPools[hetznerCloudAllocation.queue].enqueueAction(
		ctx,
		internal.allocations.hetzner_cloud.worker.run,
		{
			allocationId: hetznerCloudAllocation.allocationId,
			epoch: hetznerCloudAllocation.epoch,
		},
		{ retry: false },
	);
	await ctx.db.patch("hetznerCloudAllocations", hetznerCloudAllocation._id, {
		dueAt: Date.now() + leaseMs,
	});
}

export async function createHetznerCloudAllocation(
	ctx: MutationCtx,
	allocationId: Id<"serverAllocations">,
	config: HetznerCloudConfig,
) {
	const id = await ctx.db.insert("hetznerCloudAllocations", {
		allocationId,
		...config,
		resources: {
			ipv4: { status: "pending" },
			ipv6: { status: "pending" },
			server: { status: "pending" },
		},
		queue: "work",
		dueAt: Date.now(),
		leaseExpiresAt: 0,
		epoch: 0,
	});
	const hetznerCloudAllocation = await ctx.db.get(
		"hetznerCloudAllocations",
		id,
	);
	if (hetznerCloudAllocation !== null) {
		await enqueue(ctx, hetznerCloudAllocation);
	}
}

export async function checkHetznerCloudPower(
	ctx: QueryCtx,
	allocationId: Id<"serverAllocations">,
): Promise<Failure | null> {
	const hetznerCloudAllocation = await requireHetznerCloudAllocation(
		ctx,
		allocationId,
	);
	if (hetznerCloudAllocation.resources.server.status !== "present") {
		return fail("power_unavailable");
	}
	if (
		hetznerCloudAllocation.leaseExpiresAt > Date.now() ||
		hetznerCloudAllocation.action !== undefined
	) {
		return fail("server_busy");
	}
	return null;
}

export async function wakeHetznerCloudAllocation(
	ctx: MutationCtx,
	allocationId: Id<"serverAllocations">,
) {
	const allocation = await ctx.db.get("serverAllocations", allocationId);
	const hetznerCloudAllocation = await requireHetznerCloudAllocation(
		ctx,
		allocationId,
	);
	const queue: HetznerCloudQueue =
		allocation !== null && isAllocationDeleting(allocation)
			? "cleanup"
			: "work";
	const isLeased = hetznerCloudAllocation.leaseExpiresAt > Date.now();
	if (allocation !== null) {
		await ctx.db.patch("serverAllocations", allocationId, {
			failure: undefined,
		});
	}
	await ctx.db.patch("hetznerCloudAllocations", hetznerCloudAllocation._id, {
		queue,
		hetznerErrorCode: undefined,
		dueAt: Math.max(Date.now(), hetznerCloudAllocation.leaseExpiresAt),
	});
	if (!isLeased) {
		await enqueue(ctx, { ...hetznerCloudAllocation, queue });
	}
}

async function scheduleHetznerCloudSweep(ctx: MutationCtx, dueAt: number) {
	if (dueAt !== idleAllocationDueAt) {
		await ctx.scheduler.runAt(
			dueAt,
			internal.allocations.hetzner_cloud.worker_state.sweep,
			{},
		);
	}
}

export const sweep = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		for (const queue of Object.keys(workPools) as HetznerCloudQueue[]) {
			const due = await ctx.db
				.query("hetznerCloudAllocations")
				.withIndex("by_queue_and_due_at", (q) =>
					q.eq("queue", queue).lte("dueAt", Date.now()),
				)
				.take(sweepBatchSize);
			for (const hetznerCloudAllocation of due) {
				if (hetznerCloudAllocation.leaseExpiresAt <= Date.now()) {
					await enqueue(ctx, hetznerCloudAllocation);
				}
			}
		}
		return null;
	},
});

export const lease = internalMutation({
	args: { allocationId: v.id("serverAllocations"), epoch: v.number() },
	returns: v.union(
		v.null(),
		v.object({
			allocation: schema.doc("serverAllocations"),
			hetznerCloudAllocation: schema.doc("hetznerCloudAllocations"),
			operation: schema.doc("serverOperations"),
		}),
	),
	handler: async (ctx, { allocationId, epoch }) => {
		const allocation = await ctx.db.get("serverAllocations", allocationId);
		const hetznerCloudAllocation = await getHetznerCloudAllocation(
			ctx,
			allocationId,
		);
		if (
			allocation === null ||
			hetznerCloudAllocation === null ||
			hetznerCloudAllocation.epoch !== epoch ||
			hetznerCloudAllocation.leaseExpiresAt > Date.now()
		) {
			return null;
		}
		const retryAt = await checkHetznerCloudPacing(
			ctx,
			hetznerCloudAllocation.controllerId,
			hetznerCloudAllocation.queue,
		);
		if (retryAt !== null) {
			await ctx.db.patch(
				"hetznerCloudAllocations",
				hetznerCloudAllocation._id,
				{ dueAt: retryAt },
			);
			await scheduleHetznerCloudSweep(ctx, retryAt);
			return null;
		}
		const leaseFields = {
			epoch: epoch + 1,
			leaseExpiresAt: Date.now() + leaseMs,
			dueAt: Date.now() + leaseMs,
		};
		await ctx.db.patch(
			"hetznerCloudAllocations",
			hetznerCloudAllocation._id,
			leaseFields,
		);
		const operation = await ctx.db.get(
			"serverOperations",
			allocation.operationId,
		);
		if (operation === null) {
			throw new Error("The allocation's operation is missing.");
		}
		return {
			allocation,
			hetznerCloudAllocation: { ...hetznerCloudAllocation, ...leaseFields },
			operation,
		};
	},
});

async function getLeasedAllocation(
	ctx: QueryCtx,
	allocationId: Id<"serverAllocations">,
	epoch: number,
) {
	const allocation = await ctx.db.get("serverAllocations", allocationId);
	const hetznerCloudAllocation = await getHetznerCloudAllocation(
		ctx,
		allocationId,
	);
	if (
		allocation === null ||
		hetznerCloudAllocation === null ||
		isAllocationDeleting(allocation) ||
		hetznerCloudAllocation.epoch !== epoch ||
		hetznerCloudAllocation.leaseExpiresAt <= Date.now()
	) {
		return null;
	}
	return { allocation, hetznerCloudAllocation };
}

/** Commits uncertainty before sending a create, so a lost reply forces discovery. */
export const markUncertain = internalMutation({
	args: {
		allocationId: v.id("serverAllocations"),
		epoch: v.number(),
		kind: hetznerCloudResourceKind,
	},
	returns: v.boolean(),
	handler: async (ctx, { allocationId, epoch, kind }) => {
		const leased = await getLeasedAllocation(ctx, allocationId, epoch);
		if (
			leased === null ||
			leased.hetznerCloudAllocation.resources[kind].status !== "pending"
		) {
			return false;
		}
		await ctx.db.patch(
			"hetznerCloudAllocations",
			leased.hetznerCloudAllocation._id,
			{
				resources: {
					...leased.hetznerCloudAllocation.resources,
					[kind]: { status: "uncertain" },
				},
			},
		);
		return true;
	},
});

export const canSendPower = internalQuery({
	args: {
		allocationId: v.id("serverAllocations"),
		epoch: v.number(),
		operationId: v.id("serverOperations"),
	},
	returns: v.boolean(),
	handler: async (ctx, { allocationId, epoch, operationId }) => {
		const leased = await getLeasedAllocation(ctx, allocationId, epoch);
		return leased !== null && leased.allocation.operationId === operationId;
	},
});

/** Cloud-init can receive SSH access only while the server resource is still pending. */
export const storeSshAccess = internalMutation({
	args: {
		epoch: v.number(),
		sshAccess: sshTables.allocationSshAccess.validator,
	},
	returns: v.union(v.null(), schema.doc("allocationSshAccess")),
	handler: async (ctx, { epoch, sshAccess }) => {
		const leased = await getLeasedAllocation(
			ctx,
			sshAccess.allocationId,
			epoch,
		);
		if (
			leased === null ||
			leased.hetznerCloudAllocation.resources.server.status !== "pending"
		) {
			return null;
		}
		return await storeAllocationSshAccess(ctx, sshAccess);
	},
});

const mismatchedParts = {
	server: "mismatch",
	addresses: "unknown",
	firewall: "unknown",
} as const satisfies Infer<typeof allocationParts>;

function toObservationPatch(observed: ServerObservation | null) {
	// A mismatched server must not supply addresses to this allocation.
	return {
		observedAt: Date.now(),
		parts: observed?.parts ?? mismatchedParts,
		...(observed === null
			? {}
			: { ipv4: observed.addresses.ipv4, ipv6: observed.addresses.ipv6 }),
	} satisfies AllocationPatch<Doc<"serverAllocations">>;
}

async function isSettled(
	ctx: MutationCtx,
	allocation: Doc<"serverAllocations">,
	hetznerCloudAllocation: HetznerCloudAllocation,
) {
	if (
		isAllocationDeleting(allocation) ||
		hetznerCloudAllocation.action !== undefined ||
		hetznerCloudAllocation.leaseExpiresAt > Date.now()
	) {
		return false;
	}
	const operation = await ctx.db.get(
		"serverOperations",
		allocation.operationId,
	);
	return operation !== null && operation.status !== "pending";
}

export async function storeHetznerCloudObservation(
	ctx: MutationCtx,
	hetznerCloudAllocation: HetznerCloudAllocation,
	server: HetznerCloudServer,
) {
	const allocation = await ctx.db.get(
		"serverAllocations",
		hetznerCloudAllocation.allocationId,
	);
	if (allocation === null) {
		return;
	}
	const observed = observeHetznerCloudServer(hetznerCloudAllocation, server);
	const settled =
		observed !== null &&
		(await isSettled(ctx, allocation, hetznerCloudAllocation));
	await ctx.db.patch("serverAllocations", allocation._id, {
		...toObservationPatch(observed),
		...(settled && server.status !== "changing"
			? { status: server.status }
			: {}),
	});
	if (settled && observed?.parts.firewall === "missing") {
		await ctx.db.patch("hetznerCloudAllocations", hetznerCloudAllocation._id, {
			dueAt: Date.now(),
		});
	}
}

export const record = internalMutation({
	args: {
		allocationId: v.id("serverAllocations"),
		epoch: v.number(),
		operationId: v.id("serverOperations"),
		queue: hetznerCloudQueue,
		outcome: hetznerCloudOutcome,
		usage: hetznerCloudUsage,
	},
	returns: v.null(),
	handler: async (
		ctx,
		{ allocationId, epoch, operationId, queue, outcome, usage },
	) => {
		const allocation = await ctx.db.get("serverAllocations", allocationId);
		const provider = await getHetznerCloudAllocation(ctx, allocationId);
		const resumeAt =
			provider === null
				? Date.now()
				: await chargeHetznerCloudPacing(
						ctx,
						provider.controllerId,
						queue,
						usage,
					);
		if (allocation === null || provider === null || provider.epoch !== epoch) {
			return null;
		}
		const operation = await ctx.db.get("serverOperations", operationId);
		if (operation === null) {
			return null;
		}
		const transition = getHetznerCloudTransition(
			{ allocation, provider, operation, now: Date.now() },
			outcome,
		);
		await ctx.db.patch(
			"serverAllocations",
			allocationId,
			transition.allocation,
		);
		const dueAt = Math.max(
			transition.provider.dueAt ?? provider.dueAt,
			resumeAt,
		);
		await ctx.db.patch("hetznerCloudAllocations", provider._id, {
			...transition.provider,
			dueAt,
		});
		if (transition.operation !== undefined) {
			await ctx.db.patch("serverOperations", operationId, transition.operation);
		}
		if (outcome.kind === "deleted") {
			await ctx.runMutation(internal.servers.lifecycle.finishDelete, {
				allocationId,
			});
		} else {
			await scheduleHetznerCloudSweep(ctx, dueAt);
		}
		return null;
	},
});

export const retry = internalMutation({
	args: {
		allocationId: v.id("serverAllocations"),
		recovery: v.object({
			operationId: v.id("serverOperations"),
			stuckSince: v.number(),
		}),
		confirmedAbsent: v.optional(hetznerCloudResourceKind),
	},
	returns: v.null(),
	handler: async (ctx, { allocationId, recovery, confirmedAbsent }) => {
		const allocation = await ctx.db.get("serverAllocations", allocationId);
		const hetznerCloudAllocation = await getHetznerCloudAllocation(
			ctx,
			allocationId,
		);
		if (
			allocation === null ||
			hetznerCloudAllocation === null ||
			hetznerCloudAllocation.leaseExpiresAt > Date.now()
		) {
			throw new Error("The allocation cannot be retried now.");
		}
		const operation = await ctx.db.get(
			"serverOperations",
			allocation.operationId,
		);
		if (
			operation === null ||
			recovery.operationId !== allocation.operationId ||
			operation.status === "superseded" ||
			(operation.status !== "blocked" &&
				getAllocationStuck(allocation.failure) === null) ||
			getAllocationStuck(allocation.failure)?.since !== recovery.stuckSince
		) {
			throw new Error("The allocation recovery fence is stale.");
		}
		const resources = { ...hetznerCloudAllocation.resources };
		if (confirmedAbsent !== undefined) {
			if (resources[confirmedAbsent].status !== "uncertain") {
				throw new Error(
					"Only an uncertain resource needs absence confirmation.",
				);
			}
			resources[confirmedAbsent] = {
				status: isAllocationDeleting(allocation) ? "absent" : "pending",
			};
		}
		await ctx.db.patch("serverOperations", allocation.operationId, {
			status: "pending",
			finishedAt: undefined,
			...(operation?.deadlineAt === undefined
				? {}
				: { deadlineAt: Date.now() + hetznerCloudPowerDeadlineMs }),
		});
		await ctx.db.patch("serverAllocations", allocationId, {
			status: getRetryAllocationStatus(operation.kind, allocation.status),
			failure: undefined,
		});
		await ctx.db.patch("hetznerCloudAllocations", hetznerCloudAllocation._id, {
			resources,
			// Fences any run still in flight so its result cannot undo recovery.
			epoch: hetznerCloudAllocation.epoch + 1,
			dueAt: Date.now(),
			action: undefined,
			hetznerErrorCode: undefined,
		});
		return null;
	},
});

export async function deleteHetznerCloudAllocation(
	ctx: MutationCtx,
	allocationId: Id<"serverAllocations">,
) {
	const provider = await getHetznerCloudAllocation(ctx, allocationId);
	if (provider !== null) {
		await ctx.db.delete("hetznerCloudAllocations", provider._id);
	}
}
