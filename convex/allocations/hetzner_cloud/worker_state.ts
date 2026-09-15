import { Workpool } from "@convex-dev/workpool";
import { type Infer, v } from "convex/values";
import { components, internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	type MutationCtx,
	type QueryCtx,
} from "../../_generated/server";
import { type Failure, fail } from "../../errors";
import schema from "../../schema";
import { storeAllocationSshAccess } from "../../ssh/access_state";
import { sshTables } from "../../ssh/schema";
import { type HetznerCloudConfig, hetznerCloudRateLimiter } from "./api";
import {
	type hetznerCloudQueue,
	hetznerCloudResourceKind,
	hetznerCloudResourceStatus,
	hetznerCloudSpec,
} from "./schema";

export const hetznerCloudPowerDeadlineMs = 300_000;
const leaseMs = 120_000;
const idleMs = 300_000;
const recordDelayMs = 5000;
const firstBackoffMs = 10_000;
const maxBackoffMs = 3_600_000;
const backoffJitterMs = 5000;
const maxFailures = 8;
const blockedRecheckMs = 3_600_000;
const sweepBatchSize = 10;
// One lease can lead to several Hetzner requests in one step.
const requestsPerClaim = 8;
const never = Number.MAX_SAFE_INTEGER;

type HetznerCloudQueue = Infer<typeof hetznerCloudQueue>;
type HetznerCloudAllocation = Doc<"hetznerCloudAllocations">;
// Mirrors Convex's patch value: only an optional field can be removed with undefined.
type Patch<Document> = {
	[Field in keyof Document]?: undefined extends Document[Field]
		? Document[Field] | undefined
		: Document[Field];
};

const workPools: Record<HetznerCloudQueue, Workpool> = {
	work: new Workpool(components.hetznerCloudWork, {
		maxParallelism: 2,
		retryActionsByDefault: false,
	}),
	cleanup: new Workpool(components.hetznerCloudCleanup, {
		maxParallelism: 1,
		retryActionsByDefault: false,
	}),
};

const rateLimitNames = {
	work: "hetznerCloudWork",
	cleanup: "hetznerCloudCleanup",
} as const satisfies Record<HetznerCloudQueue, string>;

export const hetznerCloudWorkPool = workPools.work;

export const hetznerCloudWorkerUpdate = v.object({
	resource: v.optional(
		v.object({
			kind: hetznerCloudResourceKind,
			status: hetznerCloudResourceStatus,
			address: v.optional(v.string()),
		}),
	),
	spec: v.optional(hetznerCloudSpec),
	observation: v.optional(
		v.object({
			status: v.union(v.literal("running"), v.literal("stopped")),
			ipv4: v.string(),
			ipv6: v.string(),
		}),
	),
	deleted: v.optional(v.literal(true)),
	actionId: v.optional(v.number()),
	clearAction: v.optional(v.literal(true)),
	failure: v.optional(
		v.object({
			error: v.string(),
			hetznerErrorCode: v.optional(v.string()),
			retry: v.boolean(),
			retryAfterMs: v.optional(v.number()),
			missing: v.optional(v.literal(true)),
		}),
	),
});

export type HetznerCloudWorkerUpdate = Infer<typeof hetznerCloudWorkerUpdate>;

export async function getHetznerCloudAllocation(
	ctx: QueryCtx,
	allocationId: Id<"serverAllocations">,
) {
	return await ctx.db
		.query("hetznerCloudAllocations")
		.withIndex("by_allocation_id", (q) => q.eq("allocationId", allocationId))
		.unique();
}

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
		failures: 0,
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

/** Keeps the epoch and resource identities, so a create request that is still running can be found later. */
export async function wakeHetznerCloudAllocation(
	ctx: MutationCtx,
	allocationId: Id<"serverAllocations">,
) {
	const allocation = await ctx.db.get("serverAllocations", allocationId);
	const hetznerCloudAllocation = await requireHetznerCloudAllocation(
		ctx,
		allocationId,
	);
	const queue: HetznerCloudQueue = allocation?.deleteRequested
		? "cleanup"
		: "work";
	const isLeased = hetznerCloudAllocation.leaseExpiresAt > Date.now();
	await ctx.db.patch("hetznerCloudAllocations", hetznerCloudAllocation._id, {
		queue,
		failures: 0,
		error: undefined,
		dueAt: Math.max(Date.now(), hetznerCloudAllocation.leaseExpiresAt),
	});
	if (!isLeased) {
		await enqueue(ctx, { ...hetznerCloudAllocation, queue });
	}
}

export const sweep = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		// Each queue gets its own share of every batch, so new work cannot delay cleanup.
		for (const queue of ["cleanup", "work"] as const) {
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
			hetznerCloudAllocation.leaseExpiresAt > Date.now() ||
			allocation.status === "deleted"
		) {
			return null;
		}
		const rateLimit = await hetznerCloudRateLimiter.limit(
			ctx,
			rateLimitNames[hetznerCloudAllocation.queue],
			{ count: requestsPerClaim },
		);
		if (!rateLimit.ok) {
			await ctx.db.patch(
				"hetznerCloudAllocations",
				hetznerCloudAllocation._id,
				{
					dueAt: Date.now() + rateLimit.retryAfter,
				},
			);
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
		allocation.deleteRequested ||
		hetznerCloudAllocation.epoch !== epoch ||
		hetznerCloudAllocation.leaseExpiresAt <= Date.now()
	) {
		return null;
	}
	return { allocation, hetznerCloudAllocation };
}

/**
 * Recorded before the create request, so a lost response is later found by lookup and never sent again.
 */
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

/**
 * Stores SSH access only while the server is not requested yet, because cloud-init receives its public key.
 */
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

function toBackoffMs(failures: number) {
	return (
		Math.min(
			maxBackoffMs,
			firstBackoffMs * 2 ** Math.min(failures, maxFailures),
		) + Math.floor(Math.random() * backoffJitterMs)
	);
}

async function blockOperation(
	ctx: MutationCtx,
	operationId: Id<"serverOperations">,
) {
	const operation = await ctx.db.get("serverOperations", operationId);
	if (operation !== null && operation.status !== "succeeded") {
		await ctx.db.patch("serverOperations", operationId, { status: "blocked" });
	}
}

async function succeedOperation(
	ctx: MutationCtx,
	operationId: Id<"serverOperations">,
) {
	const operation = await ctx.db.get("serverOperations", operationId);
	if (operation !== null && operation.status !== "succeeded") {
		await ctx.db.patch("serverOperations", operationId, {
			status: "succeeded",
			finishedAt: Date.now(),
		});
	}
}

type Recording = {
	ctx: MutationCtx;
	allocation: Doc<"serverAllocations">;
	hetznerCloudAllocation: HetznerCloudAllocation;
	/** False when the operation that the run acted on was replaced while the run was outstanding. */
	isCurrentOperation: boolean;
	allocationPatch: Patch<Doc<"serverAllocations">>;
	hetznerCloudPatch: Patch<HetznerCloudAllocation>;
};

// A resource that appears after an uncertain create unblocks the operation.
async function recordResource(
	recording: Recording,
	resource: NonNullable<HetznerCloudWorkerUpdate["resource"]>,
) {
	const { ctx, allocation, hetznerCloudAllocation } = recording;
	recording.hetznerCloudPatch.resources = {
		...hetznerCloudAllocation.resources,
		[resource.kind]: resource.status,
	};
	// Knowing the address before the server boots lets the host key report be bound to it.
	if (resource.address !== undefined) {
		switch (resource.kind) {
			case "ipv4":
				recording.allocationPatch.ipv4 = resource.address;
				break;
			case "ipv6":
				recording.allocationPatch.ipv6 = resource.address;
				break;
			case "server":
				break;
		}
	}
	if (
		resource.status.status === "present" &&
		hetznerCloudAllocation.resources[resource.kind].status === "uncertain" &&
		allocation.status === "blocked" &&
		recording.isCurrentOperation
	) {
		recording.allocationPatch.status = allocation.deleteRequested
			? "deleting"
			: "creating";
		await ctx.db.patch("serverOperations", allocation.operationId, {
			status: "pending",
		});
	}
}

async function recordObservation(
	recording: Recording,
	observation: NonNullable<HetznerCloudWorkerUpdate["observation"]>,
) {
	const { ctx, allocation, allocationPatch } = recording;
	allocationPatch.observedAt = Date.now();
	allocationPatch.ipv4 = observation.ipv4;
	allocationPatch.ipv6 = observation.ipv6;
	if (!recording.isCurrentOperation) {
		return;
	}
	if (allocation.deleteRequested) {
		allocationPatch.status = "deleting";
		return;
	}
	allocationPatch.status = observation.status;
	await succeedOperation(ctx, allocation.operationId);
	recording.hetznerCloudPatch.dueAt = Date.now() + idleMs;
}

async function recordFailure(
	recording: Recording,
	failure: NonNullable<HetznerCloudWorkerUpdate["failure"]>,
) {
	const { ctx, allocation, hetznerCloudAllocation, allocationPatch } =
		recording;
	const retryAt =
		Date.now() +
		Math.max(
			toBackoffMs(hetznerCloudAllocation.failures),
			failure.retryAfterMs ?? 0,
		);
	recording.hetznerCloudPatch.error = failure.error;
	if (failure.missing) {
		allocationPatch.observedAt = Date.now();
	}
	recording.hetznerCloudPatch.hetznerErrorCode = failure.hetznerErrorCode;
	recording.hetznerCloudPatch.failures = hetznerCloudAllocation.failures + 1;
	recording.hetznerCloudPatch.dueAt = retryAt;
	if (
		!recording.isCurrentOperation ||
		(failure.retry && hetznerCloudAllocation.failures < maxFailures)
	) {
		return;
	}
	allocationPatch.status = failure.missing ? "missing" : "blocked";
	recording.hetznerCloudPatch.dueAt = Math.max(
		retryAt,
		Date.now() + blockedRecheckMs,
	);
	await blockOperation(ctx, allocation.operationId);
}

async function recordDeleted(recording: Recording) {
	const { ctx, allocation, hetznerCloudAllocation, allocationPatch } =
		recording;
	const resources =
		recording.hetznerCloudPatch.resources ?? hetznerCloudAllocation.resources;
	if (Object.values(resources).some(({ status }) => status !== "absent")) {
		throw new Error("An allocation cannot be deleted before its resources.");
	}
	allocationPatch.status = "deleted";
	allocationPatch.observedAt = Date.now();
	allocationPatch.ipv4 = undefined;
	allocationPatch.ipv6 = undefined;
	recording.hetznerCloudPatch.dueAt = never;
	if (recording.isCurrentOperation) {
		await succeedOperation(ctx, allocation.operationId);
	}
	if (allocation.status !== "deleted") {
		await ctx.scheduler.runAfter(
			0,
			internal.allocations.operations.finishDelete,
			{ allocationId: allocation._id },
		);
	}
}

function recordAction(recording: Recording, update: HetznerCloudWorkerUpdate) {
	if (update.spec) {
		recording.hetznerCloudPatch.spec = update.spec;
		recording.allocationPatch.location = update.spec.location;
	}
	if (update.clearAction) {
		recording.hetznerCloudPatch.action = undefined;
	}
	if (update.actionId !== undefined) {
		recording.hetznerCloudPatch.action = {
			id: update.actionId,
			startedAt: Date.now(),
		};
	}
}

export const record = internalMutation({
	args: {
		allocationId: v.id("serverAllocations"),
		epoch: v.number(),
		operationId: v.id("serverOperations"),
		update: hetznerCloudWorkerUpdate,
	},
	returns: v.null(),
	handler: async (ctx, { allocationId, epoch, operationId, update }) => {
		const allocation = await ctx.db.get("serverAllocations", allocationId);
		const hetznerCloudAllocation = await getHetznerCloudAllocation(
			ctx,
			allocationId,
		);
		if (
			allocation === null ||
			hetznerCloudAllocation === null ||
			hetznerCloudAllocation.epoch !== epoch
		) {
			return null;
		}
		const recording: Recording = {
			ctx,
			allocation,
			hetznerCloudAllocation,
			isCurrentOperation: allocation.operationId === operationId,
			allocationPatch: {},
			hetznerCloudPatch: {
				leaseExpiresAt: 0,
				dueAt: Date.now() + recordDelayMs,
				failures: 0,
				error: undefined,
				hetznerErrorCode: undefined,
			},
		};
		if (update.resource) {
			await recordResource(recording, update.resource);
		}
		recordAction(recording, update);
		if (update.observation) {
			await recordObservation(recording, update.observation);
		}
		if (update.failure) {
			await recordFailure(recording, update.failure);
		}
		if (update.deleted) {
			await recordDeleted(recording);
		}
		await ctx.db.patch(
			"serverAllocations",
			allocationId,
			recording.allocationPatch,
		);
		await ctx.db.patch(
			"hetznerCloudAllocations",
			hetznerCloudAllocation._id,
			recording.hetznerCloudPatch,
		);
		return null;
	},
});

/**
 * Admin recovery. Confirm absence only after checking that no earlier request can still create the resource.
 */
export const retry = internalMutation({
	args: {
		allocationId: v.id("serverAllocations"),
		confirmedAbsent: v.optional(hetznerCloudResourceKind),
	},
	returns: v.null(),
	handler: async (ctx, { allocationId, confirmedAbsent }) => {
		const allocation = await ctx.db.get("serverAllocations", allocationId);
		const hetznerCloudAllocation = await getHetznerCloudAllocation(
			ctx,
			allocationId,
		);
		if (
			allocation === null ||
			hetznerCloudAllocation === null ||
			allocation.status === "deleted" ||
			hetznerCloudAllocation.leaseExpiresAt > Date.now()
		) {
			throw new Error("The allocation cannot be retried now.");
		}
		const resources = { ...hetznerCloudAllocation.resources };
		if (confirmedAbsent !== undefined) {
			if (resources[confirmedAbsent].status !== "uncertain") {
				throw new Error(
					"Only an uncertain resource needs absence confirmation.",
				);
			}
			resources[confirmedAbsent] = {
				status: allocation.deleteRequested ? "absent" : "pending",
			};
		}
		const operation = await ctx.db.get(
			"serverOperations",
			allocation.operationId,
		);
		await ctx.db.patch("serverOperations", allocation.operationId, {
			status: "pending",
			...(operation?.deadlineAt === undefined
				? {}
				: { deadlineAt: Date.now() + hetznerCloudPowerDeadlineMs }),
		});
		await ctx.db.patch("serverAllocations", allocationId, {
			status: allocation.deleteRequested ? "deleting" : "creating",
		});
		await ctx.db.patch("hetznerCloudAllocations", hetznerCloudAllocation._id, {
			resources,
			// A new epoch fences a run that is still outstanding, so its result cannot undo this.
			epoch: hetznerCloudAllocation.epoch + 1,
			failures: 0,
			dueAt: Date.now(),
			action: undefined,
			error: undefined,
			hetznerErrorCode: undefined,
		});
		return null;
	},
});
