import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { requireStaff } from "../authorization";
import {
	boxMetricsSamples,
	vMetricsRange,
	type MetricsRange,
	vRolledMetric,
	type RolledMetric
} from "../boxes/boxMetrics";
import { findBoxBySlug } from "../boxes/boxQueries";

const FLAG_LIST_LIMIT = 50;
const TOP_BOXES = 8;
const RAW_RANK_DOCUMENT_LIMIT = 8000;

async function slugsById(ctx: QueryCtx, boxIds: Iterable<Id<"boxes">>) {
	const slugs = new Map<Id<"boxes">, string>();
	for (const boxId of boxIds) {
		if (slugs.has(boxId)) continue;
		const box = await ctx.db.get(boxId);
		slugs.set(boxId, box?.slug ?? "deleted");
	}
	return slugs;
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
		metric: v.optional(vRolledMetric),
		range: v.optional(vMetricsRange),
		slug: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await requireStaff(ctx);
		const range: MetricsRange = args.range ?? "24h";

		if (args.slug) {
			const box = await findBoxBySlug(ctx, args.slug);
			if (!box) return [];
			return [
				{
					slug: box.slug,
					samples: await boxMetricsSamples(ctx, box._id, range)
				}
			];
		}

		const boxIds = await topBoxIds(ctx, args.metric ?? "cpu_percent");
		const slugs = await slugsById(ctx, boxIds);

		const series = [];
		for (const boxId of boxIds) {
			series.push({
				slug: slugs.get(boxId) ?? "deleted",
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
		slug: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await requireStaff(ctx);

		let flags: Doc<"box_flags">[];
		if (args.slug) {
			const box = await findBoxBySlug(ctx, args.slug);
			if (!box) return [];
			flags = await ctx.db
				.query("box_flags")
				.withIndex("box_id", (builder) => builder.eq("box_id", box._id))
				.order("desc")
				.take(FLAG_LIST_LIMIT);
		} else {
			flags = await ctx.db
				.query("box_flags")
				.order("desc")
				.take(FLAG_LIST_LIMIT);
		}
		const slugs = await slugsById(
			ctx,
			flags.map((flag) => flag.box_id)
		);

		return flags.map((flag) => ({
			id: flag._id,
			slug: slugs.get(flag.box_id) ?? "deleted",
			signal: flag.signal,
			message: flag.message,
			value: flag.value,
			autoSuspended: flag.auto_suspended,
			createdAt: flag.created_at
		}));
	}
});
