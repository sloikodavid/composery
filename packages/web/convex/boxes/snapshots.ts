import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
	internalAction,
	internalMutation,
	internalQuery,
	type MutationCtx
} from "../_generated/server";
import { vSnapshotClass, type OperationTrigger } from "../schema";
import {
	BOX_PLANS,
	planAllowsManualSnapshots,
	resolveSnapshotSplit
} from "../model/box/plan";
import type { Infer } from "convex/values";
import { readGlobalSettings } from "../settings";
import { appendBoxEvent } from "./operation/event";
import { boxEventType } from "../model/box/operation";
import { reconcileCapacityAlert } from "./capacity";
import { startBoxOperation } from "./operation/start";
import {
	AUTOMATIC_SNAPSHOT_INTERVAL_MS,
	SNAPSHOT_INCOMPLETE_RETENTION_MS,
	SNAPSHOT_RETENTION_SWEEP_BATCH,
	snapshotEvictionCount,
	snapshotExpiry,
	manualSnapshotIntervalMs,
	snapshotIdempotencyBucket,
	snapshotScheduleDelayMs
} from "./snapshotPolicy";

type SnapshotClass = Infer<typeof vSnapshotClass>;
type StartCtx = MutationCtx;

const SNAPSHOT_SCHEDULE_PAGE_SIZE = 200;
const SNAPSHOT_CASCADE_DELETE_PAGE_SIZE = 100;
const ACTIVE_SNAPSHOT_STATUSES = [
	"pending",
	"creating",
	"complete"
] as const satisfies readonly Doc<"box_snapshots">["status"][];
const DELETABLE_SNAPSHOT_STATUSES = [
	"pending",
	"creating",
	"complete",
	"failed"
] as const satisfies readonly Doc<"box_snapshots">["status"][];

export function snapshotView(snapshot: Doc<"box_snapshots">) {
	return {
		id: snapshot._id,
		class: snapshot.class,
		status: snapshot.status,
		sizeBytes: snapshot.size_bytes ?? null,
		createdAt: snapshot.created_at,
		completedAt: snapshot.completed_at ?? null,
		expiresAt: snapshot.expires_at ?? null
	};
}

async function countActiveSnapshotsByClass(
	ctx: StartCtx,
	boxId: Id<"boxes">,
	cls: SnapshotClass,
	limit: number
) {
	let count = 0;
	// Loosening this bound reaches the same verdict by construction: a wider
	// `take` still returns only the rows that exist, and stopping a status later
	// still leaves `count` at or above the limit. What the verdict is used for is
	// covered; how few rows it read to get there is not observable, which is why
	// mutants on the bound itself survive.
	for (const status of ACTIVE_SNAPSHOT_STATUSES) {
		// `limit - count` is always at least one here, so there is no budget check
		// at the top of the loop: the return below leaves as soon as the budget is
		// spent, and every caller asks for a cap plus at least one. A guard here
		// duplicated that condition and could not fire.
		const rows = await ctx.db
			.query("box_snapshots")
			.withIndex("box_id_class_status_created_at", (builder) =>
				builder.eq("box_id", boxId).eq("class", cls).eq("status", status)
			)
			.take(limit - count);
		count += rows.length;

		// Stopped early, so `count` is a floor rather than the total - which is
		// what `exact` reports, and what admission refuses on rather than guessing.
		if (count >= limit) return { count, exact: false };
	}

	return { count, exact: true };
}

async function oldestAutomaticCompleteSnapshotIds(
	ctx: StartCtx,
	boxId: Id<"boxes">,
	limit: number
) {
	// An early exit rather than a decision: asking for none would take none
	// anyway, so this only saves the query.
	// Stryker disable next-line ConditionalExpression,EqualityOperator: `.take(0)` returns nothing, so skipping the query and running it are the same answer.
	if (limit <= 0) return [];

	const rows = await ctx.db
		.query("box_snapshots")
		.withIndex("box_id_class_status_created_at", (builder) =>
			builder
				.eq("box_id", boxId)
				.eq("class", "scheduled")
				.eq("status", "complete")
		)
		.order("asc")
		.take(limit);
	return rows.map((row) => row._id);
}

// Manual snapshots: refuse at cap, never evict. Automatic snapshots: evict the
// oldest automatic snapshot to make room. Manual snapshots are never evicted
// by either path.
async function snapshotCapacityPlan(
	ctx: StartCtx,
	box: Doc<"boxes">,
	cls: SnapshotClass
) {
	const boxId = box._id;
	const split = resolveSnapshotSplit(box.plan, box.manual_snapshot_cap);
	if (cls === "manual") {
		const cap = split.manual;
		const { count } = await countActiveSnapshotsByClass(
			ctx,
			boxId,
			"manual",
			cap + 1
		);
		return {
			canInsert: count < cap,
			evictions: [] as Id<"box_snapshots">[],
			requiredEvictions: 0
		};
	}

	const cap = split.automatic;
	const capRepairBatch = cap + 1;
	const activeCountLimit = cap + capRepairBatch;

	const { count, exact } = await countActiveSnapshotsByClass(
		ctx,
		boxId,
		"scheduled",
		activeCountLimit
	);
	const requiredEvictions = snapshotEvictionCount(count, cap);
	const evictions = await oldestAutomaticCompleteSnapshotIds(
		ctx,
		boxId,
		Math.min(requiredEvictions, capRepairBatch)
	);

	return {
		canInsert:
			exact &&
			evictions.length === requiredEvictions &&
			requiredEvictions <= capRepairBatch,
		evictions,
		requiredEvictions
	};
}

async function assertSnapshotCapacity(
	ctx: StartCtx,
	box: Doc<"boxes">,
	cls: SnapshotClass
) {
	const plan = await snapshotCapacityPlan(ctx, box, cls);
	if (!plan.canInsert) {
		throw new ConvexError(
			"This box has reached its snapshot limit. Delete one to take another, or give manual snapshots a bigger share of its allowance."
		);
	}
}

async function prepareSnapshotCapacity(
	ctx: StartCtx,
	box: Doc<"boxes">,
	cls: SnapshotClass
) {
	const plan = await snapshotCapacityPlan(ctx, box, cls);
	for (const snapshotRowId of plan.evictions) {
		await ctx.scheduler.runAfter(0, internal.boxes.snapshots.runDelete, {
			snapshotRowId
		});
	}

	if (!plan.canInsert) {
		throw new ConvexError(
			"This box has reached its snapshot limit. Delete one to take another, or give manual snapshots a bigger share of its allowance."
		);
	}
}

// The shared owner + staff path for a manual snapshot: the box must be running,
// no snapshot may be in flight, the manual cooldown must have elapsed, and the
// manual cap must leave room. Only the idempotency-key prefix differs between
// the two callers.
export async function startManualSnapshot(
	ctx: StartCtx,
	box: Doc<"boxes">,
	idempotencyKeyPrefix: string,
	trigger: OperationTrigger
) {
	// Capture-on-demand is a plan capability, and this is the gate for every
	// caller of it - owner and staff alike. Staff are not exempted: a manual
	// snapshot on a plan without them would commit a provider slot that capacity
	// admission never reserved for this box, so the exception would be a quiet
	// over-subscription of the fleet's snapshot quota rather than a favour.
	if (!planAllowsManualSnapshots(box.plan)) {
		throw new ConvexError(
			`${BOX_PLANS[box.plan].label} takes automatic daily snapshots. Switch to ${BOX_PLANS.pro.label} to capture one whenever you want.`
		);
	}
	if (box.status !== "running") {
		throw new ConvexError(
			"Snapshots are only available while the box is running."
		);
	}

	const { snapshotPolicy } = await readGlobalSettings(ctx);
	const manualMinIntervalMs = manualSnapshotIntervalMs(snapshotPolicy);

	const last = await ctx.db
		.query("box_snapshots")
		.withIndex("box_id_created_at", (builder) => builder.eq("box_id", box._id))
		.order("desc")
		.first();
	if (last && (last.status === "pending" || last.status === "creating")) {
		throw new ConvexError("A snapshot is already in progress.");
	}
	if (last && Date.now() - last.created_at < manualMinIntervalMs) {
		throw new ConvexError(
			"A snapshot was taken moments ago. Try again in a few minutes."
		);
	}
	await assertSnapshotCapacity(ctx, box, "manual");

	const operationId = await startBoxOperation(ctx, box._id, "snapshot", {
		idempotencyKey: `${idempotencyKeyPrefix}:${box._id}:${snapshotIdempotencyBucket(Date.now(), manualMinIntervalMs)}`,
		trigger,
		// Stryker disable next-line ObjectLiteral,StringLiteral: read only inside the workflow body, which this harness cannot run (packages/web/tests/support/convex.ts).
		workflowArgs: { class: "manual" }
	});
	// `startBoxOperation` hands back nothing when an active operation already
	// holds this key, and without this the caller would report a capture that is
	// never going to happen. No test reaches it: the same active operation is
	// refused as "this box is busy" before the key is ever compared, so the only
	// way here is a reordering of those two checks - which is exactly the change
	// this guard is here to survive.
	// Stryker disable next-line ConditionalExpression,BlockStatement: unreachable while the busy check precedes the idempotency check; kept so a reordering cannot turn a deduplicated start into a silent success.
	if (!operationId) {
		throw new ConvexError("A snapshot is already in progress.");
	}
}

export const beginSnapshot = internalMutation({
	args: { boxId: v.id("boxes"), class: vSnapshotClass },
	handler: async (ctx, args) => {
		const box = await ctx.db.get(args.boxId);
		if (!box) throw new ConvexError("Box not found.");

		await prepareSnapshotCapacity(ctx, box, args.class);

		const now = Date.now();
		const snapshotRowId = await ctx.db.insert("box_snapshots", {
			box_id: box._id,
			user_id: box.user_id,
			class: args.class,
			status: "pending",
			created_at: now,
			expires_at: now + SNAPSHOT_INCOMPLETE_RETENTION_MS
		});
		return { snapshotRowId };
	}
});

export const markCreating = internalMutation({
	args: {
		snapshotRowId: v.id("box_snapshots"),
		imageId: v.number(),
		actionId: v.number()
	},
	handler: async (ctx, args) => {
		const snapshot = await ctx.db.get(args.snapshotRowId);
		if (!snapshot || snapshot.status === "deleting") return;

		await ctx.db.patch(args.snapshotRowId, {
			status: "creating",
			hetzner_image_id: args.imageId,
			hetzner_action_id: args.actionId
		});
	}
});

export const completeSnapshot = internalMutation({
	args: {
		snapshotRowId: v.id("box_snapshots"),
		operationId: v.id("box_operations"),
		sizeBytes: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		// Close the operation first and unconditionally: the capture succeeded even
		// if the snapshot row was meanwhile marked deleting/removed. Leaving it
		// open would brick every later operation on the box.
		await ctx.db.patch(args.operationId, {
			status: "succeeded",
			finished_at: now,
			updated_at: now
		});

		const snapshot = await ctx.db.get(args.snapshotRowId);
		if (!snapshot) return;
		if (snapshot.status === "deleting") return;

		const { snapshotPolicy } = await readGlobalSettings(ctx);
		await ctx.db.patch(args.snapshotRowId, {
			status: "complete",
			size_bytes: args.sizeBytes,
			completed_at: now,
			expires_at: snapshotExpiry(
				snapshot.class,
				snapshot.created_at,
				snapshotPolicy
			)
		});

		const box = await ctx.db.get(snapshot.box_id);
		if (box) {
			await appendBoxEvent(ctx, box, boxEventType("snapshot", "succeeded"), {
				metadata: { class: snapshot.class, sizeBytes: args.sizeBytes ?? null }
			});
		}
	}
});

export const failSnapshot = internalMutation({
	args: { snapshotRowId: v.id("box_snapshots"), error: v.string() },
	handler: async (ctx, args) => {
		const snapshot = await ctx.db.get(args.snapshotRowId);
		if (!snapshot) return;
		if (snapshot.status === "deleting") return;

		await ctx.db.patch(args.snapshotRowId, {
			status: "failed",
			error: args.error,
			expires_at: Date.now() + SNAPSHOT_INCOMPLETE_RETENTION_MS
		});
	}
});

export const markRestoreSucceeded = internalMutation({
	args: {
		boxId: v.id("boxes"),
		operationId: v.id("box_operations"),
		snapshotRowId: v.id("box_snapshots")
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		// The operation closes first and unconditionally, for the reason
		// `completeSnapshot` above states: the restore succeeded, and an operation
		// left open blocks every later action on the box - including the teardown
		// that would be why the box is no longer there.
		//
		// This used to patch the box first, which threw on a missing one and left
		// the operation open for ever - and made the `box` guard below unreachable,
		// so the code read as though it handled the case it was failing.
		await ctx.db.patch(args.operationId, {
			status: "succeeded",
			finished_at: now,
			updated_at: now
		});

		const box = await ctx.db.get(args.boxId);
		if (!box) return;

		await ctx.db.patch(args.boxId, { status: "running", updated_at: now });
		await appendBoxEvent(ctx, box, boxEventType("restore", "succeeded"), {
			metadata: { snapshotRowId: args.snapshotRowId }
		});
	}
});

export const runningBoxIdsPage = internalQuery({
	args: {
		cursor: v.union(v.string(), v.null())
	},
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query("boxes")
			.withIndex("status", (builder) => builder.eq("status", "running"))
			.paginate({
				cursor: args.cursor,
				numItems: SNAPSHOT_SCHEDULE_PAGE_SIZE
			});

		return {
			...page,
			page: page.page.map((box) => box._id)
		};
	}
});

export const snapshotRestoreTarget = internalQuery({
	args: { snapshotRowId: v.id("box_snapshots") },
	handler: async (ctx, args) => {
		const snapshot = await ctx.db.get(args.snapshotRowId);
		if (
			!snapshot ||
			snapshot.status !== "complete" ||
			snapshot.hetzner_image_id === undefined
		) {
			return null;
		}
		return { imageId: snapshot.hetzner_image_id };
	}
});

export async function markSnapshotDeleting(
	ctx: StartCtx,
	snapshotRowId: Id<"box_snapshots">
) {
	const snapshot = await ctx.db.get(snapshotRowId);
	if (!snapshot) return null;

	// Only a row that is not already being deleted needs moving; re-patching one
	// that is would write the value it already holds.
	// Stryker disable next-line ConditionalExpression,StringLiteral: patching "deleting" over "deleting" leaves the row identical, so a test cannot see the difference.
	if (snapshot.status !== "deleting") {
		await ctx.db.patch(snapshotRowId, { status: "deleting" });
	}

	return { imageId: snapshot.hetzner_image_id };
}

export const claimSnapshotDelete = internalMutation({
	args: { snapshotRowId: v.id("box_snapshots") },
	handler: async (ctx, args) => {
		return await markSnapshotDeleting(ctx, args.snapshotRowId);
	}
});

export const removeSnapshotRow = internalMutation({
	args: { snapshotRowId: v.id("box_snapshots") },
	handler: async (ctx, args) => {
		const snapshot = await ctx.db.get(args.snapshotRowId);
		if (!snapshot) return;
		await ctx.db.delete(args.snapshotRowId);
		await reconcileCapacityAlert(ctx);
	}
});

export const runDelete = internalAction({
	args: { snapshotRowId: v.id("box_snapshots") },
	handler: async (ctx, args) => {
		const target = await ctx.runMutation(
			internal.boxes.snapshots.claimSnapshotDelete,
			{ snapshotRowId: args.snapshotRowId }
		);
		if (!target) return;

		// Presence, not truthiness: a row that never reached Hetzner has no image
		// id at all, which is the only case that may skip the provider delete.
		if (target.imageId !== undefined) {
			await ctx.runAction(internal.boxes.infra.hetznerVps.deleteImage, {
				imageId: target.imageId
			});
		}
		await ctx.runMutation(internal.boxes.snapshots.removeSnapshotRow, {
			snapshotRowId: args.snapshotRowId
		});
	}
});

export const cascadeDeleteBoxSnapshots = internalMutation({
	args: {
		boxId: v.id("boxes"),
		cursor: v.optional(v.union(v.string(), v.null()))
	},
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query("box_snapshots")
			.withIndex("box_id_created_at", (builder) =>
				builder.eq("box_id", args.boxId)
			)
			.paginate({
				cursor: args.cursor ?? null,
				numItems: SNAPSHOT_CASCADE_DELETE_PAGE_SIZE
			});

		for (const row of page.page) {
			await ctx.scheduler.runAfter(0, internal.boxes.snapshots.runDelete, {
				snapshotRowId: row._id
			});
		}

		if (!page.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.boxes.snapshots.cascadeDeleteBoxSnapshots,
				{
					boxId: args.boxId,
					cursor: page.continueCursor
				}
			);
		}
	}
});

export const claimExpiredSnapshots = internalMutation({
	args: { limit: v.number() },
	handler: async (ctx, args) => {
		const now = Date.now();
		const limit = Math.max(0, Math.floor(args.limit));
		const snapshotRowIds: Id<"box_snapshots">[] = [];

		for (const status of DELETABLE_SNAPSHOT_STATUSES) {
			const remaining = limit - snapshotRowIds.length;
			if (remaining <= 0) break;

			const rows = await ctx.db
				.query("box_snapshots")
				// Bounded from below for the reason `purge_at`'s sweeps are: Convex
				// orders a missing optional field beneath every number, so a bare
				// `lt("expires_at", now)` also selects every snapshot that has no
				// expiry at all - and this sweep's next move is to delete the image.
				// A snapshot with no expiry is one nothing has decided about yet, and
				// the failure direction here is the owner's only copy of their files.
				.withIndex("status_expires_at", (builder) =>
					builder
						.eq("status", status)
						.gte("expires_at", 0)
						.lt("expires_at", now)
				)
				.take(remaining);

			for (const row of rows) {
				await ctx.db.patch(row._id, { status: "deleting" });
				snapshotRowIds.push(row._id);
			}
		}

		return {
			hasMore: limit > 0 && snapshotRowIds.length === limit,
			snapshotRowIds
		};
	}
});

export const deleteExpiredSnapshots = internalAction({
	args: {},
	handler: async (ctx) => {
		const claim = await ctx.runMutation(
			internal.boxes.snapshots.claimExpiredSnapshots,
			{ limit: SNAPSHOT_RETENTION_SWEEP_BATCH }
		);
		for (const snapshotRowId of claim.snapshotRowIds) {
			await ctx.scheduler.runAfter(0, internal.boxes.snapshots.runDelete, {
				snapshotRowId
			});
		}
		if (claim.hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.boxes.snapshots.deleteExpiredSnapshots,
				{}
			);
		}
	}
});

export const startAutomaticSnapshot = internalMutation({
	args: { boxId: v.id("boxes") },
	handler: async (ctx, args) => {
		const box = await ctx.db.get(args.boxId);
		if (!box || box.status !== "running") return;

		// An owner may give every slot to snapshots they take themselves, which
		// leaves nothing for the daily one. Skip before starting an operation
		// rather than letting the capacity check fail inside the workflow: that
		// would record a failed snapshot every night for a box whose owner chose
		// exactly this, and a nightly failure nobody should act on is how real ones
		// stop being read.
		if (
			resolveSnapshotSplit(box.plan, box.manual_snapshot_cap).automatic === 0
		) {
			return;
		}

		try {
			await startBoxOperation(ctx, args.boxId, "snapshot", {
				// Bucketed by the automatic cadence, not by the manual cooldown: this
				// key exists to make one night's sweep idempotent, and an operator's
				// manual-interval setting has nothing to say about that.
				idempotencyKey: `auto-snapshot:${args.boxId}:${snapshotIdempotencyBucket(Date.now(), AUTOMATIC_SNAPSHOT_INTERVAL_MS)}`,
				trigger: "system:auto_snapshot",
				// Stryker disable next-line ObjectLiteral,StringLiteral: read only inside the workflow body, which this harness cannot run (packages/web/tests/support/convex.ts).
				workflowArgs: { class: "scheduled" }
			});
		} catch (error) {
			if (error instanceof ConvexError) return;
			throw error;
		}
	}
});

export const scheduleAutomaticSnapshots = internalAction({
	args: {
		cursor: v.optional(v.union(v.string(), v.null())),
		scheduledCount: v.optional(v.number())
	},
	handler: async (ctx, args): Promise<void> => {
		const page: {
			continueCursor: string;
			isDone: boolean;
			page: Id<"boxes">[];
		} = await ctx.runQuery(internal.boxes.snapshots.runningBoxIdsPage, {
			cursor: args.cursor ?? null
		});

		const scheduledOffset = Math.max(0, Math.floor(args.scheduledCount ?? 0));
		for (const [index, boxId] of page.page.entries()) {
			await ctx.scheduler.runAfter(
				snapshotScheduleDelayMs(scheduledOffset + index),
				internal.boxes.snapshots.startAutomaticSnapshot,
				{ boxId }
			);
		}

		if (!page.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.boxes.snapshots.scheduleAutomaticSnapshots,
				{
					cursor: page.continueCursor,
					scheduledCount: scheduledOffset + page.page.length
				}
			);
		}
	}
});
