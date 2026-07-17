import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
	internalMutation,
	mutation,
	query,
	type MutationCtx,
	type QueryCtx
} from "../_generated/server";
import { requireCapability } from "../authorization";
import {
	boxMetricsSamples,
	vMetricsRange,
	type MetricsRange,
	vRolledMetric,
	type RolledMetric
} from "../boxes/boxMetrics";

const FLAG_LIST_LIMIT = 50;
const FLAG_DISMISS_BATCH = 100;
const TOP_BOXES = 8;
const RAW_RANK_DOCUMENT_LIMIT = 8000;

async function boxesById(ctx: QueryCtx, boxIds: Iterable<Id<"boxes">>) {
	const boxes = new Map<Id<"boxes">, Doc<"boxes"> | null>();
	for (const boxId of boxIds) {
		if (boxes.has(boxId)) continue;
		const box = await ctx.db.get(boxId);
		boxes.set(boxId, box);
	}
	return boxes;
}

async function topBoxIds(ctx: QueryCtx, metric: RolledMetric) {
	const latest = await ctx.db
		.query("box_metrics_hourly")
		.withIndex("hour_start")
		.order("desc")
		.first();
	if (latest) {
		return await topHourlyBoxIds(ctx, latest.hour_start, metric);
	}

	const values = new Map<Id<"boxes">, number>();
	const samples = await ctx.db
		.query("box_metrics")
		.withIndex("sampled_at")
		.order("desc")
		.take(RAW_RANK_DOCUMENT_LIMIT);
	for (const sample of samples) {
		if (!values.has(sample.box_id)) {
			values.set(sample.box_id, sample[metric]);
		}
	}
	return [...values.entries()]
		.sort(([, first], [, second]) => second - first)
		.slice(0, TOP_BOXES)
		.map(([boxId]) => boxId);
}

async function topHourlyBoxIds(
	ctx: QueryCtx,
	hourStart: number,
	metric: RolledMetric
) {
	let rows: Doc<"box_metrics_hourly">[];
	switch (metric) {
		case "cpu_percent":
			rows = await ctx.db
				.query("box_metrics_hourly")
				.withIndex("hour_start_cpu_percent", (builder) =>
					builder.eq("hour_start", hourStart)
				)
				.order("desc")
				.take(TOP_BOXES);
			break;
		case "ingress_bps":
			rows = await ctx.db
				.query("box_metrics_hourly")
				.withIndex("hour_start_ingress_bps", (builder) =>
					builder.eq("hour_start", hourStart)
				)
				.order("desc")
				.take(TOP_BOXES);
			break;
		case "egress_bps":
			rows = await ctx.db
				.query("box_metrics_hourly")
				.withIndex("hour_start_egress_bps", (builder) =>
					builder.eq("hour_start", hourStart)
				)
				.order("desc")
				.take(TOP_BOXES);
			break;
		case "ingress_pps":
			rows = await ctx.db
				.query("box_metrics_hourly")
				.withIndex("hour_start_ingress_pps", (builder) =>
					builder.eq("hour_start", hourStart)
				)
				.order("desc")
				.take(TOP_BOXES);
			break;
		case "egress_pps":
			rows = await ctx.db
				.query("box_metrics_hourly")
				.withIndex("hour_start_egress_pps", (builder) =>
					builder.eq("hour_start", hourStart)
				)
				.order("desc")
				.take(TOP_BOXES);
			break;
		case "disk_read_bps":
			rows = await ctx.db
				.query("box_metrics_hourly")
				.withIndex("hour_start_disk_read_bps", (builder) =>
					builder.eq("hour_start", hourStart)
				)
				.order("desc")
				.take(TOP_BOXES);
			break;
		case "disk_write_bps":
			rows = await ctx.db
				.query("box_metrics_hourly")
				.withIndex("hour_start_disk_write_bps", (builder) =>
					builder.eq("hour_start", hourStart)
				)
				.order("desc")
				.take(TOP_BOXES);
			break;
	}

	return rows.map((row) => row.box_id);
}

export const series = query({
	args: {
		boxId: v.optional(v.id("boxes")),
		metric: v.optional(vRolledMetric),
		range: v.optional(vMetricsRange)
	},
	handler: async (ctx, args) => {
		await requireCapability(ctx, "staff_console");
		const range: MetricsRange = args.range ?? "24h";

		if (args.boxId) {
			const box = await ctx.db.get(args.boxId);
			if (!box) return [];
			return [
				{
					slug: box.slug,
					samples: await boxMetricsSamples(ctx, box._id, range)
				}
			];
		}

		const boxIds = await topBoxIds(ctx, args.metric ?? "cpu_percent");
		const boxes = await boxesById(ctx, boxIds);

		const series = [];
		for (const boxId of boxIds) {
			const box = boxes.get(boxId);
			if (!box) continue;
			series.push({
				slug: box.slug,
				samples: await boxMetricsSamples(ctx, boxId, range)
			});
		}
		return series.sort((first, second) =>
			first.slug.localeCompare(second.slug)
		);
	}
});

export const flags = query({
	args: {
		boxId: v.optional(v.id("boxes"))
	},
	handler: async (ctx, args) => {
		await requireCapability(ctx, "staff_console");

		let flags: Doc<"box_flags">[];
		if (args.boxId) {
			const box = await ctx.db.get(args.boxId);
			if (!box) return [];
			flags = await ctx.db
				.query("box_flags")
				.withIndex("box_id", (builder) => builder.eq("box_id", box._id))
				.order("desc")
				.take(FLAG_LIST_LIMIT);
		} else {
			flags = await ctx.db
				.query("box_flags")
				.withIndex("dismissed_created_at", (builder) =>
					builder.eq("dismissed_at", undefined)
				)
				.order("desc")
				.take(FLAG_LIST_LIMIT);
		}
		const boxes = await boxesById(
			ctx,
			flags.map((flag) => flag.box_id)
		);

		return flags.flatMap((flag) => {
			const box = boxes.get(flag.box_id);
			if (!box) return [];
			return [
				{
					id: flag._id,
					boxId: box._id,
					slug: box.slug,
					hetznerServerId: box.hetzner_server_id ?? null,
					signal: flag.signal,
					message: flag.message,
					value: flag.value,
					autoSuspended: flag.auto_suspended,
					createdAt: flag.created_at,
					dismissedAt: flag.dismissed_at ?? null
				}
			];
		});
	}
});

export const dismissFlag = mutation({
	args: {
		flagId: v.id("box_flags")
	},
	handler: async (ctx, args) => {
		const staffUser = await requireCapability(ctx, "box_operations");
		const flag = await ctx.db.get(args.flagId);
		if (!flag || flag.dismissed_at) return;

		await ctx.db.patch(flag._id, {
			dismissed_at: Date.now(),
			dismissed_by: staffUser.clerk_user_id
		});
	}
});

async function dismissFlagBatch(
	ctx: MutationCtx,
	boxId: Id<"boxes"> | undefined,
	dismissedBy: string
) {
	const flags = boxId
		? await ctx.db
				.query("box_flags")
				.withIndex("box_id_dismissed_created_at", (query) =>
					query.eq("box_id", boxId).eq("dismissed_at", undefined)
				)
				.take(FLAG_DISMISS_BATCH)
		: await ctx.db
				.query("box_flags")
				.withIndex("dismissed_created_at", (query) =>
					query.eq("dismissed_at", undefined)
				)
				.take(FLAG_DISMISS_BATCH);
	const timestamp = Date.now();
	for (const flag of flags) {
		await ctx.db.patch(flag._id, {
			dismissed_at: timestamp,
			dismissed_by: dismissedBy
		});
	}
	return flags.length === FLAG_DISMISS_BATCH;
}

export const dismissAllFlags = mutation({
	args: { boxId: v.optional(v.id("boxes")) },
	handler: async (ctx, args) => {
		const staffUser = await requireCapability(ctx, "box_operations");
		const hasMore = await dismissFlagBatch(
			ctx,
			args.boxId,
			staffUser.clerk_user_id
		);
		if (hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.staff.metrics.dismissAllFlagsBatch,
				{
					boxId: args.boxId,
					dismissedBy: staffUser.clerk_user_id
				}
			);
		}
	}
});

export const dismissAllFlagsBatch = internalMutation({
	args: {
		boxId: v.optional(v.id("boxes")),
		dismissedBy: v.string()
	},
	handler: async (ctx, args) => {
		const hasMore = await dismissFlagBatch(ctx, args.boxId, args.dismissedBy);
		if (hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.staff.metrics.dismissAllFlagsBatch,
				{
					boxId: args.boxId,
					dismissedBy: args.dismissedBy
				}
			);
		}
	}
});
