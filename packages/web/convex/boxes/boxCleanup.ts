import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import {
	billingRecordPurgeAt,
	deletedCheckoutSlug,
	deletedBoxDataPatch,
	retainedOperationMetadata,
	terminalCheckoutSecretPatch
} from "./boxRetention";

const DELETE_BATCH_SIZE = 100;
const CLEANUP_RETRY_MS = 24 * 60 * 60 * 1000;

export const normalizeDeletedBoxes = internalMutation({
	args: {},
	handler: async (ctx) => {
		const boxes = await ctx.db
			.query("boxes")
			.withIndex("status", (query) => query.eq("status", "deleted"))
			.filter((query) => query.eq(query.field("purge_at"), undefined))
			.take(DELETE_BATCH_SIZE);
		for (const box of boxes) {
			const deletedAt = box.deleted_at ?? box.updated_at;
			await ctx.db.patch(box._id, deletedBoxDataPatch(deletedAt));
			await ctx.scheduler.runAfter(
				0,
				internal.boxes.boxCleanup.deleteRuntimeData,
				{
					boxId: box._id
				}
			);
			await ctx.scheduler.runAfter(
				0,
				internal.boxes.boxCleanup.sanitizeOperations,
				{
					boxId: box._id
				}
			);
			await ctx.scheduler.runAfter(
				0,
				internal.boxes.boxCleanup.sanitizeEvents,
				{
					boxId: box._id
				}
			);
			await ctx.scheduler.runAfter(
				0,
				internal.boxes.boxCleanup.startCheckoutRetention,
				{
					boxId: box._id,
					deletedAt
				}
			);
		}
		if (boxes.length === DELETE_BATCH_SIZE) {
			await ctx.scheduler.runAfter(
				0,
				internal.boxes.boxCleanup.normalizeDeletedBoxes,
				{}
			);
		}
	}
});

export const deleteRuntimeData = internalMutation({
	args: { boxId: v.id("boxes") },
	handler: async (ctx, args) => {
		const authCodes = await ctx.db
			.query("box_auth_codes")
			.withIndex("box_id", (query) => query.eq("box_id", args.boxId))
			.take(DELETE_BATCH_SIZE);
		const authGrants = await ctx.db
			.query("box_auth_grants")
			.withIndex("box_id", (query) => query.eq("box_id", args.boxId))
			.take(DELETE_BATCH_SIZE);
		const metrics = await ctx.db
			.query("box_metrics")
			.withIndex("box_id_sampled_at", (query) => query.eq("box_id", args.boxId))
			.take(DELETE_BATCH_SIZE);
		const hourlyMetrics = await ctx.db
			.query("box_metrics_hourly")
			.withIndex("box_id_hour_start", (query) => query.eq("box_id", args.boxId))
			.take(DELETE_BATCH_SIZE);
		for (const row of [
			...authCodes,
			...authGrants,
			...metrics,
			...hourlyMetrics
		]) {
			await ctx.db.delete(row._id);
		}
		if (
			[authCodes, authGrants, metrics, hourlyMetrics].some(
				(rows) => rows.length === DELETE_BATCH_SIZE
			)
		) {
			await ctx.scheduler.runAfter(
				0,
				internal.boxes.boxCleanup.deleteRuntimeData,
				{
					boxId: args.boxId
				}
			);
		}
	}
});

export const startCheckoutRetention = internalMutation({
	args: {
		boxId: v.id("boxes"),
		deletedAt: v.number(),
		cursor: v.optional(v.union(v.string(), v.null()))
	},
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query("box_checkout_intents")
			.withIndex("box_id", (query) => query.eq("box_id", args.boxId))
			.paginate({ cursor: args.cursor ?? null, numItems: DELETE_BATCH_SIZE });
		for (const intent of page.page) {
			await ctx.db.patch(intent._id, {
				purge_at: billingRecordPurgeAt(args.deletedAt),
				...terminalCheckoutSecretPatch()
			});
		}
		if (!page.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.boxes.boxCleanup.startCheckoutRetention,
				{
					boxId: args.boxId,
					deletedAt: args.deletedAt,
					cursor: page.continueCursor
				}
			);
		}
	}
});

export const purgeExpiredCheckoutRecords = internalMutation({
	args: {},
	handler: async (ctx) => {
		const timestamp = Date.now();
		const intents = await ctx.db
			.query("box_checkout_intents")
			.withIndex("purge_at", (query) => query.lte("purge_at", timestamp))
			.take(DELETE_BATCH_SIZE);
		for (const intent of intents) {
			if ((intent.retain_until ?? 0) > timestamp) {
				await ctx.db.patch(intent._id, { purge_at: intent.retain_until });
				continue;
			}
			if (intent.box_id && (await ctx.db.get(intent.box_id))) {
				await ctx.db.patch(intent._id, {
					purge_at: timestamp + CLEANUP_RETRY_MS
				});
				continue;
			}
			await ctx.db.delete(intent._id);
		}
		if (intents.length === DELETE_BATCH_SIZE) {
			await ctx.scheduler.runAfter(
				0,
				internal.boxes.boxCleanup.purgeExpiredCheckoutRecords,
				{}
			);
		}
	}
});

export const sanitizeOperations = internalMutation({
	args: {
		boxId: v.id("boxes"),
		cursor: v.optional(v.union(v.string(), v.null()))
	},
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query("box_operations")
			.withIndex("box_id", (query) => query.eq("box_id", args.boxId))
			.paginate({ cursor: args.cursor ?? null, numItems: DELETE_BATCH_SIZE });
		for (const operation of page.page) {
			await ctx.db.patch(operation._id, {
				idempotency_key: `deleted:${operation._id}`,
				reserved_slug: undefined,
				last_error: undefined,
				metadata: retainedOperationMetadata(operation.type, operation.metadata)
			});
		}
		if (!page.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.boxes.boxCleanup.sanitizeOperations,
				{
					boxId: args.boxId,
					cursor: page.continueCursor
				}
			);
		}
	}
});

export const sanitizeEvents = internalMutation({
	args: {
		boxId: v.id("boxes"),
		cursor: v.optional(v.union(v.string(), v.null()))
	},
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query("box_events")
			.withIndex("box_id", (query) => query.eq("box_id", args.boxId))
			.paginate({ cursor: args.cursor ?? null, numItems: DELETE_BATCH_SIZE });
		for (const event of page.page) {
			await ctx.db.patch(event._id, {
				message: undefined,
				metadata: undefined
			});
		}
		if (!page.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.boxes.boxCleanup.sanitizeEvents,
				{
					boxId: args.boxId,
					cursor: page.continueCursor
				}
			);
		}
	}
});

export const scheduleExpiredBoxPurges = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query("boxes")
			.withIndex("status_purge_at", (query) =>
				query.eq("status", "deleted").lte("purge_at", Date.now())
			)
			.paginate({ cursor: args.cursor ?? null, numItems: DELETE_BATCH_SIZE });
		for (const box of page.page) {
			await ctx.scheduler.runAfter(0, internal.boxes.boxCleanup.purgeBox, {
				boxId: box._id
			});
		}
		if (!page.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.boxes.boxCleanup.scheduleExpiredBoxPurges,
				{ cursor: page.continueCursor }
			);
		}
	}
});

export const purgeBox = internalMutation({
	args: { boxId: v.id("boxes") },
	handler: async (ctx, args) => {
		const box = await ctx.db.get(args.boxId);
		if (
			!box ||
			box.status !== "deleted" ||
			(box.purge_at ?? Infinity) > Date.now()
		) {
			return;
		}

		const authCodes = await ctx.db
			.query("box_auth_codes")
			.withIndex("box_id", (query) => query.eq("box_id", args.boxId))
			.take(DELETE_BATCH_SIZE);
		const authGrants = await ctx.db
			.query("box_auth_grants")
			.withIndex("box_id", (query) => query.eq("box_id", args.boxId))
			.take(DELETE_BATCH_SIZE);
		const operations = await ctx.db
			.query("box_operations")
			.withIndex("box_id", (query) => query.eq("box_id", args.boxId))
			.take(DELETE_BATCH_SIZE);
		const events = await ctx.db
			.query("box_events")
			.withIndex("box_id", (query) => query.eq("box_id", args.boxId))
			.take(DELETE_BATCH_SIZE);
		const metrics = await ctx.db
			.query("box_metrics")
			.withIndex("box_id_sampled_at", (query) => query.eq("box_id", args.boxId))
			.take(DELETE_BATCH_SIZE);
		const hourlyMetrics = await ctx.db
			.query("box_metrics_hourly")
			.withIndex("box_id_hour_start", (query) => query.eq("box_id", args.boxId))
			.take(DELETE_BATCH_SIZE);
		const flags = await ctx.db
			.query("box_flags")
			.withIndex("box_id", (query) => query.eq("box_id", args.boxId))
			.take(DELETE_BATCH_SIZE);
		const intents = await ctx.db
			.query("box_checkout_intents")
			.withIndex("box_id", (query) => query.eq("box_id", args.boxId))
			.take(DELETE_BATCH_SIZE);
		const snapshots = await ctx.db
			.query("box_snapshots")
			.withIndex("box_id", (query) => query.eq("box_id", args.boxId))
			.take(DELETE_BATCH_SIZE);

		const rows = [
			...authCodes,
			...authGrants,
			...operations,
			...events,
			...metrics,
			...hourlyMetrics,
			...flags
		];
		for (const row of rows) await ctx.db.delete(row._id);
		for (const intent of intents) {
			await ctx.db.patch(intent._id, {
				box_id: undefined,
				slug: deletedCheckoutSlug(intent._id)
			});
		}
		for (const snapshot of snapshots) {
			await ctx.scheduler.runAfter(0, internal.boxes.boxSnapshots.runDelete, {
				snapshotRowId: snapshot._id
			});
		}

		if (rows.length > 0 || intents.length > 0 || snapshots.length > 0) {
			await ctx.scheduler.runAfter(
				snapshots.length > 0 ? 60_000 : 0,
				internal.boxes.boxCleanup.purgeBox,
				{ boxId: args.boxId }
			);
			return;
		}

		await ctx.db.delete(box._id);
	}
});
