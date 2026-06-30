import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
	internalAction,
	internalMutation,
	internalQuery,
	type MutationCtx
} from "../_generated/server";
import { vSnapshotClass } from "../schema";
import type { Infer } from "convex/values";
import { readGlobalSettings } from "../settings";
import { appendBoxEvent } from "./boxEvents";
import { startBoxOperation } from "./boxOperations";
import {
	SNAPSHOT_INCOMPLETE_RETENTION_MS,
	SNAPSHOT_RETENTION_SWEEP_BATCH,
	snapshotEvictionCount,
	snapshotExpiry,
	snapshotIdempotencyBucket,
	snapshotScheduleDelayMs,
	type SnapshotPolicy
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

const MINUTE_MS = 60 * 1000;

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
	for (const status of ACTIVE_SNAPSHOT_STATUSES) {
		const remaining = limit - count;
		if (remaining <= 0) return { count, exact: false };

		const rows = await ctx.db
			.query("box_snapshots")
			.withIndex("box_id_class_status_created_at", (builder) =>
				builder.eq("box_id", boxId).eq("class", cls).eq("status", status)
			)
			.take(remaining);
		count += rows.length;

		if (count >= limit) {
			return { count, exact: false };
		}
	}

	return { count, exact: true };
}

async function oldestAutomaticCompleteSnapshotIds(
	ctx: StartCtx,
	boxId: Id<"boxes">,
	limit: number
) {
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
	boxId: Id<"boxes">,
	cls: SnapshotClass,
	policy: SnapshotPolicy
) {
	if (cls === "manual") {
		const cap = policy.manualCap;
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

	const cap = policy.automaticCap;
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
	boxId: Id<"boxes">,
	cls: SnapshotClass,
	policy: SnapshotPolicy
) {
	const plan = await snapshotCapacityPlan(ctx, boxId, cls, policy);
	if (!plan.canInsert) {
		throw new ConvexError(
			"This box has reached its snapshot limit. Delete a snapshot to take a new one."
		);
	}
}

async function prepareSnapshotCapacity(
	ctx: StartCtx,
	boxId: Id<"boxes">,
	cls: SnapshotClass,
	policy: SnapshotPolicy
) {
	const plan = await snapshotCapacityPlan(ctx, boxId, cls, policy);
	for (const snapshotRowId of plan.evictions) {
		await ctx.scheduler.runAfter(0, internal.boxes.boxSnapshots.runDelete, {
			snapshotRowId
		});
	}

	if (!plan.canInsert) {
		throw new ConvexError(
			"This box has reached its snapshot limit. Delete a snapshot to take a new one."
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
	idempotencyKeyPrefix: string
) {
	if (box.status !== "running") {
		throw new ConvexError(
			"Snapshots are only available while the box is running."
		);
	}

	const { snapshotPolicy } = await readGlobalSettings(ctx);
	const manualMinIntervalMs =
		snapshotPolicy.manualMinIntervalMinutes * MINUTE_MS;

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
	await assertSnapshotCapacity(ctx, box._id, "manual", snapshotPolicy);

	const operationId = await startBoxOperation(ctx, box._id, "snapshot", {
		idempotencyKey: `${idempotencyKeyPrefix}:${box._id}:${snapshotIdempotencyBucket(Date.now(), manualMinIntervalMs)}`,
		workflowArgs: { class: "manual" }
	});
	if (!operationId) {
		throw new ConvexError("A snapshot is already in progress.");
	}
}

export const beginSnapshot = internalMutation({
	args: { boxId: v.id("boxes"), class: vSnapshotClass },
	handler: async (ctx, args) => {
		const box = await ctx.db.get(args.boxId);
		if (!box) throw new ConvexError("Box not found.");

		const { snapshotPolicy } = await readGlobalSettings(ctx);
		await prepareSnapshotCapacity(ctx, box._id, args.class, snapshotPolicy);

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
			await appendBoxEvent(ctx, box, "box.snapshot_created", {
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
		await ctx.db.patch(args.boxId, { status: "running", updated_at: now });
		await ctx.db.patch(args.operationId, {
			status: "succeeded",
			finished_at: now,
			updated_at: now
		});
		const box = await ctx.db.get(args.boxId);
		if (box) {
			await appendBoxEvent(ctx, box, "box.snapshot_restored", {
				metadata: { snapshotRowId: args.snapshotRowId }
			});
		}
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
	}
});

export const runDelete = internalAction({
	args: { snapshotRowId: v.id("box_snapshots") },
	handler: async (ctx, args) => {
		const target = await ctx.runMutation(
			internal.boxes.boxSnapshots.claimSnapshotDelete,
			{ snapshotRowId: args.snapshotRowId }
		);
		if (!target) return;

		if (target.imageId) {
			await ctx.runAction(internal.boxes.infra.hetznerVps.deleteImage, {
				imageId: target.imageId
			});
		}
		await ctx.runMutation(internal.boxes.boxSnapshots.removeSnapshotRow, {
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
			.withIndex("box_id", (builder) => builder.eq("box_id", args.boxId))
			.paginate({
				cursor: args.cursor ?? null,
				numItems: SNAPSHOT_CASCADE_DELETE_PAGE_SIZE
			});

		for (const row of page.page) {
			await ctx.scheduler.runAfter(0, internal.boxes.boxSnapshots.runDelete, {
				snapshotRowId: row._id
			});
		}

		if (!page.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.boxes.boxSnapshots.cascadeDeleteBoxSnapshots,
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
				.withIndex("status_expires_at", (builder) =>
					builder.eq("status", status).lt("expires_at", now)
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
			internal.boxes.boxSnapshots.claimExpiredSnapshots,
			{ limit: SNAPSHOT_RETENTION_SWEEP_BATCH }
		);
		for (const snapshotRowId of claim.snapshotRowIds) {
			await ctx.scheduler.runAfter(0, internal.boxes.boxSnapshots.runDelete, {
				snapshotRowId
			});
		}
		if (claim.hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.boxes.boxSnapshots.deleteExpiredSnapshots,
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

		const { snapshotPolicy } = await readGlobalSettings(ctx);
		const manualMinIntervalMs =
			snapshotPolicy.manualMinIntervalMinutes * MINUTE_MS;

		try {
			await startBoxOperation(ctx, args.boxId, "snapshot", {
				idempotencyKey: `auto-snapshot:${args.boxId}:${snapshotIdempotencyBucket(Date.now(), manualMinIntervalMs)}`,
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
		} = await ctx.runQuery(internal.boxes.boxSnapshots.runningBoxIdsPage, {
			cursor: args.cursor ?? null
		});

		const scheduledOffset = Math.max(0, Math.floor(args.scheduledCount ?? 0));
		for (const [index, boxId] of page.page.entries()) {
			await ctx.scheduler.runAfter(
				snapshotScheduleDelayMs(scheduledOffset + index),
				internal.boxes.boxSnapshots.startAutomaticSnapshot,
				{ boxId }
			);
		}

		if (!page.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.boxes.boxSnapshots.scheduleAutomaticSnapshots,
				{
					cursor: page.continueCursor,
					scheduledCount: scheduledOffset + page.page.length
				}
			);
		}
	}
});
