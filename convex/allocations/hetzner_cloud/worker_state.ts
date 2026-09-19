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
import { failureClass, isStuck, toRetryDelayMs } from "../retries";
import type { allocationParts } from "../schema";
import type { HetznerCloudConfig } from "./api";
import {
	type HetznerCloudServer,
	hetznerCloudServerState,
	observeHetznerCloudServer,
	type ServerObservation,
} from "./observation";
import { chargeHetznerCloudPacing, checkHetznerCloudPacing } from "./pacing";
import {
	hetznerCloudQueue,
	hetznerCloudResourceKind,
	hetznerCloudResourceStatus,
	hetznerCloudSpec,
	hetznerCloudUsage,
} from "./schema";

export const hetznerCloudPowerDeadlineMs = 300_000;
const leaseMs = 120_000;
const recordDelayMs = 5000;
const sweepBatchSize = 10;
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
	// Which firewall this allocation is behind, learnt from the label it carries.
	firewallId: v.optional(v.number()),
	// The server as the worker found it. What it means for the allocation is worked out here,
	// from the allocation as it is now, so that the scan's look and the worker's say the same
	// things about it.
	observation: v.optional(hetznerCloudServerState),
	deleted: v.optional(v.literal(true)),
	actionId: v.optional(v.number()),
	clearAction: v.optional(v.literal(true)),
	failure: v.optional(
		v.object({
			error: v.string(),
			hetznerErrorCode: v.optional(v.string()),
			class: failureClass,
			retryAfterMs: v.optional(v.number()),
			// The resource this allocation ran on is not there any more.
			missing: v.optional(v.literal(true)),
			// The operation itself is over: its own deadline passed, so asking again is not the job.
			final: v.optional(v.literal(true)),
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

/** What the backend last recorded for one allocation, which is where a stuck allocation says why. */
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

/**
 * Asks for a sweep when an allocation is next due, so that its next step waits for its own delay
 * and not for the cron as well. The cron stays, for a lease that runs out without an answer.
 */
async function scheduleHetznerCloudSweep(ctx: MutationCtx, dueAt: number) {
	if (dueAt !== never) {
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
	// A resource that turns up after an uncertain create is the answer nobody had: the allocation
	// is not stuck on it any more.
	if (
		resource.status.status === "present" &&
		hetznerCloudAllocation.resources[resource.kind].status === "uncertain" &&
		recording.isCurrentOperation
	) {
		recording.allocationPatch.stuck = undefined;
		await ctx.db.patch("serverOperations", allocation.operationId, {
			status: "pending",
		});
	}
}

const mismatchedParts = {
	server: "mismatch",
	addresses: "unknown",
	firewall: "unknown",
} as const satisfies Infer<typeof allocationParts>;

/** What one look at the server changes about the allocation, whoever looked at it. */
function toObservationPatch(observed: ServerObservation | null) {
	return {
		observedAt: Date.now(),
		// A server that is not the one this allocation recorded says nothing about its other parts.
		parts: observed?.parts ?? mismatchedParts,
		// An address that is not the one this allocation holds is not this server's to give out,
		// so none is shown until the allocation has it back.
		...(observed === null
			? {}
			: { ipv4: observed.addresses.ipv4, ipv6: observed.addresses.ipv6 }),
	} satisfies Patch<Doc<"serverAllocations">>;
}

/**
 * Whether nothing is being done to this allocation, so that a server seen from a page is the
 * state it settled on rather than a step in the middle of a change somebody asked for.
 */
async function isSettled(
	ctx: MutationCtx,
	allocation: Doc<"serverAllocations">,
	hetznerCloudAllocation: HetznerCloudAllocation,
) {
	if (
		allocation.deleteRequested ||
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

/**
 * Records a server that the inventory scan saw. The scan reads fifty servers in one request,
 * so an allocation nobody is working on stays current without a request of its own. It writes
 * down only what was seen: an operation belongs to whoever holds the lease, and a stuck
 * allocation stays stuck, because seeing the server is no answer to what the work ran into.
 */
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
		// A server that is still changing says nothing about where it will stop.
		...(settled && server.status !== "changing"
			? { status: server.status }
			: {}),
	});
	// A settled allocation is never looked at by its own worker, so what the scan sees is all there
	// is. Something the worker can put right is the one reason to wake it: rules taken off a server
	// go back on, and nothing else here decides anything.
	if (settled && observed?.parts.firewall === "missing") {
		await ctx.db.patch("hetznerCloudAllocations", hetznerCloudAllocation._id, {
			dueAt: Date.now(),
		});
	}
}

async function recordObservation(
	recording: Recording,
	server: NonNullable<HetznerCloudWorkerUpdate["observation"]>,
) {
	const { ctx, allocation, hetznerCloudAllocation, allocationPatch } =
		recording;
	const observed = observeHetznerCloudServer(hetznerCloudAllocation, server);
	Object.assign(allocationPatch, toObservationPatch(observed));
	if (
		observed === null ||
		server.status === "changing" ||
		!recording.isCurrentOperation
	) {
		return;
	}
	// Seeing the server as this allocation recorded it is the answer to whatever the last attempt
	// ran into.
	allocationPatch.stuck = undefined;
	if (allocation.deleteRequested) {
		allocationPatch.status = "deleting";
		return;
	}
	allocationPatch.status = server.status;
	await succeedOperation(ctx, allocation.operationId);
	// A settled allocation is then left alone. The scan reads every server anyway, which is what
	// notices a change nobody asked us for, at one request for fifty of them instead of one each.
	recording.hetznerCloudPatch.dueAt = never;
}

/**
 * Writes down what went wrong and when to come back to it. How often a failure has happened decides
 * only how long the wait is: it never decides that a passing condition has become a permanent one.
 * An allocation that is stuck says so and is still picked up again, forever, because a customer's
 * server nobody comes back to is worse than one request an hour.
 */
async function recordFailure(
	recording: Recording,
	failure: NonNullable<HetznerCloudWorkerUpdate["failure"]>,
) {
	const { ctx, allocation, hetznerCloudAllocation, allocationPatch } =
		recording;
	recording.hetznerCloudPatch.error = failure.error;
	if (failure.missing) {
		allocationPatch.observedAt = Date.now();
	}
	recording.hetznerCloudPatch.hetznerErrorCode = failure.hetznerErrorCode;
	const failures = hetznerCloudAllocation.failures + 1;
	recording.hetznerCloudPatch.failures = failures;
	recording.hetznerCloudPatch.dueAt =
		Date.now() +
		Math.max(
			toRetryDelayMs(failure.class, hetznerCloudAllocation.failures),
			// Hetzner says when its own budget comes back; asking sooner spends what is left.
			failure.retryAfterMs ?? 0,
		);
	if (!recording.isCurrentOperation || !isStuck(failure.class, failures)) {
		return;
	}
	allocationPatch.stuck = {
		since: allocation.stuck?.since ?? Date.now(),
		code: failure.error,
		class: failure.class,
	};
	if (failure.missing) {
		allocationPatch.parts = { ...allocation.parts, server: "missing" };
	}
	if (failure.final) {
		// The operation asked for something by a time that has passed. Another request is not it.
		await blockOperation(ctx, allocation.operationId);
	}
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
	if (update.firewallId !== undefined) {
		recording.hetznerCloudPatch.firewallId = update.firewallId;
	}
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
		queue: hetznerCloudQueue,
		update: hetznerCloudWorkerUpdate,
		usage: hetznerCloudUsage,
	},
	returns: v.null(),
	handler: async (
		ctx,
		{ allocationId, epoch, operationId, queue, update, usage },
	) => {
		const allocation = await ctx.db.get("serverAllocations", allocationId);
		const hetznerCloudAllocation = await getHetznerCloudAllocation(
			ctx,
			allocationId,
		);
		// What the run sent is spent whether or not its result still counts.
		const resumeAt =
			hetznerCloudAllocation === null
				? Date.now()
				: await chargeHetznerCloudPacing(
						ctx,
						hetznerCloudAllocation.controllerId,
						queue,
						usage,
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
		// A floor under the next attempt when the budget is low, which never brings one forward.
		const dueAt = Math.max(
			recording.hetznerCloudPatch.dueAt ?? hetznerCloudAllocation.dueAt,
			resumeAt,
		);
		recording.hetznerCloudPatch.dueAt = dueAt;
		await ctx.db.patch(
			"hetznerCloudAllocations",
			hetznerCloudAllocation._id,
			recording.hetznerCloudPatch,
		);
		await scheduleHetznerCloudSweep(ctx, dueAt);
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

/**
 * Removes what this backend held for an allocation that no longer exists. The worker has already
 * set the row's next run to never, so nothing else reads or writes it.
 */
export const forget = internalMutation({
	args: { allocationId: v.id("serverAllocations") },
	returns: v.null(),
	handler: async (ctx, { allocationId }) => {
		const hetznerCloudAllocation = await getHetznerCloudAllocation(
			ctx,
			allocationId,
		);
		if (hetznerCloudAllocation !== null) {
			await ctx.db.delete(
				"hetznerCloudAllocations",
				hetznerCloudAllocation._id,
			);
		}
		return null;
	},
});
