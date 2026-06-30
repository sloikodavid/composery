import { Resend } from "@convex-dev/resend";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	type DatabaseReader,
	type MutationCtx
} from "../_generated/server";
import { isStaffUser } from "../authorization";
import { optionalEnv, requiredEnv, websiteOrigin } from "../env";
import type { BoxFlagSignal, BoxStatus } from "../schema";
import { readGlobalSettings } from "../settings";
import {
	crossedValue,
	isEnabled,
	type ThresholdSetting
} from "./metricThresholds";

export const METRICS_POLL_INTERVAL_MINUTES = 10;
export const METRICS_POLL_INTERVAL_MS =
	METRICS_POLL_INTERVAL_MINUTES * 60 * 1000;

const METRICS_SERIES_WINDOW_MS = 24 * 60 * 60 * 1000;
const RAW_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
const ROLLUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const ROLLUP_BOX_BATCH = 200;
const ROLLUP_SAMPLE_LIMIT = Math.ceil(HOUR_MS / METRICS_POLL_INTERVAL_MS) + 18;
const FLAG_COOLOFF_MS = 6 * 60 * 60 * 1000;
const RETENTION_DELETE_BATCH = 1000;
const POLL_TARGET_PAGE_SIZE = 200;
const STAFF_ALERT_RECIPIENT_LIMIT = 50;

function formatMbit(bps: number) {
	return `${Math.round((bps * 8) / 1_000_000)} Mbit/s`;
}

function formatPps(pps: number) {
	return `${Math.round(pps).toLocaleString("en-US")} packets/s`;
}

type ThresholdMetric = "egress_bps" | "egress_pps";

type ThresholdPresentation = {
	format: (value: number) => string;
	label: string;
	metric: ThresholdMetric;
};

const THRESHOLD_PRESENTATION: Record<BoxFlagSignal, ThresholdPresentation> = {
	egress_bandwidth: {
		metric: "egress_bps",
		label: "outbound bandwidth",
		format: formatMbit
	},
	egress_pps: {
		metric: "egress_pps",
		label: "outbound packet rate",
		format: formatPps
	}
};

type ResolvedThreshold = ThresholdSetting & ThresholdPresentation;

function presentThresholds(
	thresholds: readonly ThresholdSetting[]
): ResolvedThreshold[] {
	return thresholds.map((threshold) => ({
		...threshold,
		...THRESHOLD_PRESENTATION[threshold.signal]
	}));
}

const resend = new Resend(components.resend, { testMode: false });

export const POLLED_STATUSES = ["running", "stopped", "suspended"] as const;

const ROLLUP_BOX_STATUSES: readonly BoxStatus[] = [
	"provisioning",
	"running",
	"provisioning_failed",
	"stopping",
	"stopped",
	"starting",
	"resetting",
	"reset_failed",
	"restoring",
	"restore_failed",
	"suspending",
	"suspended",
	"unsuspending",
	"deleting",
	"delete_failed"
];

export const vPolledStatus = v.union(
	v.literal("running"),
	v.literal("stopped"),
	v.literal("suspended")
);

const ROLLED_METRICS = [
	"cpu_percent",
	"ingress_bps",
	"egress_bps",
	"ingress_pps",
	"egress_pps",
	"disk_read_bps",
	"disk_write_bps"
] as const;

export type RolledMetric = (typeof ROLLED_METRICS)[number];

export const vRolledMetric = v.union(
	...ROLLED_METRICS.map((metric) => v.literal(metric))
);

export type MetricsRange = "1h" | "6h" | "24h" | "7d" | "30d";

export const vMetricsRange = v.union(
	v.literal("1h"),
	v.literal("6h"),
	v.literal("24h"),
	v.literal("7d"),
	v.literal("30d")
);

// Raw box_metrics samples are retained for two days (polled every
// METRICS_POLL_INTERVAL_MS); beyond that the series falls back to the hourly
// box_metrics_hourly rollups, which are retained for thirty days.
const METRICS_RANGE_CONFIG: Record<
	MetricsRange,
	{ hourly: boolean; windowMs: number }
> = {
	"1h": { hourly: false, windowMs: 60 * 60 * 1000 },
	"6h": { hourly: false, windowMs: 6 * 60 * 60 * 1000 },
	"24h": { hourly: false, windowMs: METRICS_SERIES_WINDOW_MS },
	"7d": { hourly: true, windowMs: 7 * 24 * 60 * 60 * 1000 },
	"30d": { hourly: true, windowMs: 30 * 24 * 60 * 60 * 1000 }
};

export type RollupMetricSample = Record<RolledMetric, number>;

export function rollupMetricMeans<T extends RollupMetricSample>(
	samples: readonly T[]
) {
	return Object.fromEntries(
		ROLLED_METRICS.map((metric) => [
			metric,
			samples.reduce((sum, sample) => sum + sample[metric], 0) / samples.length
		])
	) as Record<RolledMetric, number>;
}

export function metricsSampleView(sample: Doc<"box_metrics">) {
	return {
		sampledAt: sample.sampled_at,
		cpuPercent: sample.cpu_percent,
		ingressBps: sample.ingress_bps,
		egressBps: sample.egress_bps,
		ingressPps: sample.ingress_pps,
		egressPps: sample.egress_pps,
		diskReadBps: sample.disk_read_bps,
		diskWriteBps: sample.disk_write_bps
	};
}

function hourlySampleView(sample: Doc<"box_metrics_hourly">) {
	return {
		sampledAt: sample.hour_start,
		cpuPercent: sample.cpu_percent,
		ingressBps: sample.ingress_bps,
		egressBps: sample.egress_bps,
		ingressPps: sample.ingress_pps,
		egressPps: sample.egress_pps,
		diskReadBps: sample.disk_read_bps,
		diskWriteBps: sample.disk_write_bps
	};
}

export async function boxMetricsSamples(
	ctx: { db: DatabaseReader },
	boxId: Id<"boxes">,
	range: MetricsRange = "24h"
) {
	const { hourly, windowMs } = METRICS_RANGE_CONFIG[range];
	const since = Date.now() - windowMs;
	if (hourly) {
		const samples = await ctx.db
			.query("box_metrics_hourly")
			.withIndex("box_id_hour_start", (query) =>
				query.eq("box_id", boxId).gte("hour_start", since)
			)
			.order("desc")
			.take(Math.ceil(windowMs / HOUR_MS) + 12);
		return samples.reverse().map(hourlySampleView);
	}
	const samples = await ctx.db
		.query("box_metrics")
		.withIndex("box_id_sampled_at", (query) =>
			query.eq("box_id", boxId).gte("sampled_at", since)
		)
		.order("desc")
		.take(Math.ceil(windowMs / METRICS_POLL_INTERVAL_MS) + 12);
	return samples.reverse().map(metricsSampleView);
}

async function emailStaff(ctx: MutationCtx, subject: string, text: string) {
	if (!optionalEnv("RESEND_API_KEY")) return;

	const admins = await ctx.db
		.query("users")
		.withIndex("role", (query) => query.eq("role", "admin"))
		.take(STAFF_ALERT_RECIPIENT_LIMIT);
	const recipients = admins.filter(isStaffUser).map((user) => user.email);
	if (recipients.length === 0) return;

	await resend.sendEmail(ctx, {
		from: requiredEnv("ALERT_EMAIL_FROM"),
		to: recipients,
		subject,
		text
	});
}

export const pollTargetsPage = internalQuery({
	args: {
		cursor: v.union(v.string(), v.null()),
		status: vPolledStatus
	},
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query("boxes")
			.withIndex("status", (query) => query.eq("status", args.status))
			.paginate({
				cursor: args.cursor,
				numItems: POLL_TARGET_PAGE_SIZE
			});

		return {
			...page,
			page: page.page
				.filter((box) => box.hetzner_server_id)
				.map((box) => ({
					boxId: box._id,
					serverId: box.hetzner_server_id as number,
					slug: box.slug
				}))
		};
	}
});

export const recordSample = internalMutation({
	args: {
		boxId: v.id("boxes"),
		cpuPercent: v.number(),
		ingressBps: v.number(),
		egressBps: v.number(),
		ingressPps: v.number(),
		egressPps: v.number(),
		diskReadBps: v.number(),
		diskWriteBps: v.number()
	},
	handler: async (
		ctx,
		args
	): Promise<{
		suspendFlagId: string | null;
		suspendReason: string | null;
	}> => {
		const none = { suspendFlagId: null, suspendReason: null };
		const box = await ctx.db.get(args.boxId);
		if (!box) return none;

		const now = Date.now();
		await ctx.db.insert("box_metrics", {
			box_id: args.boxId,
			sampled_at: now,
			cpu_percent: args.cpuPercent,
			ingress_bps: args.ingressBps,
			egress_bps: args.egressBps,
			ingress_pps: args.ingressPps,
			egress_pps: args.egressPps,
			disk_read_bps: args.diskReadBps,
			disk_write_bps: args.diskWriteBps
		});

		if (box.status !== "running") return none;

		const settings = await readGlobalSettings(ctx);
		const thresholds = presentThresholds(settings.thresholds);

		const longestWindow = Math.max(
			...thresholds.map((threshold) => threshold.sustainedSamples)
		);
		const samples = await ctx.db
			.query("box_metrics")
			.withIndex("box_id_sampled_at", (query) => query.eq("box_id", args.boxId))
			.order("desc")
			.take(longestWindow);

		let suspendFlagId: string | null = null;
		let suspendReason: string | null = null;

		for (const threshold of thresholds) {
			if (!isEnabled(threshold)) continue;
			const value = crossedValue(
				samples.map((sample) => sample[threshold.metric]),
				threshold
			);
			if (value === null) continue;

			const lastFlag = await ctx.db
				.query("box_flags")
				.withIndex("box_id_signal", (query) =>
					query.eq("box_id", args.boxId).eq("signal", threshold.signal)
				)
				.order("desc")
				.first();
			if (lastFlag && now - lastFlag.created_at < FLAG_COOLOFF_MS) continue;

			const windowMinutes =
				(threshold.sustainedSamples * METRICS_POLL_INTERVAL_MS) / 60_000;
			const message = `Sustained ${threshold.label} at ${threshold.format(
				value
			)} (threshold ${threshold.format(
				threshold.value
			)}) over the last ${windowMinutes} minutes.`;
			const autoSuspend: boolean =
				settings.autoSuspendEnabled && suspendFlagId === null;

			const flagId: Id<"box_flags"> = await ctx.db.insert("box_flags", {
				box_id: args.boxId,
				signal: threshold.signal,
				message,
				value,
				threshold: threshold.value,
				auto_suspended: autoSuspend,
				created_at: now
			});

			if (autoSuspend) {
				suspendFlagId = flagId;
				suspendReason = `Automatic suspension: ${message}`;
			}

			await emailStaff(
				ctx,
				`Box ${box.slug} flagged: ${threshold.label}`,
				`${message}\n\n${
					autoSuspend ? "The box was automatically suspended.\n\n" : ""
				}${websiteOrigin()}/console/boxes/${box.slug}`
			);
		}

		return { suspendFlagId, suspendReason };
	}
});

export const deleteOldSamples = internalMutation({
	args: {},
	handler: async (ctx) => {
		const oldSamples = await ctx.db
			.query("box_metrics")
			.withIndex("sampled_at", (query) =>
				query.lt("sampled_at", Date.now() - RAW_RETENTION_MS)
			)
			.take(RETENTION_DELETE_BATCH);
		const oldRollups = await ctx.db
			.query("box_metrics_hourly")
			.withIndex("hour_start", (query) =>
				query.lt("hour_start", Date.now() - ROLLUP_RETENTION_MS)
			)
			.take(RETENTION_DELETE_BATCH);

		for (const row of [...oldSamples, ...oldRollups]) {
			await ctx.db.delete(row._id);
		}

		if (
			oldSamples.length === RETENTION_DELETE_BATCH ||
			oldRollups.length === RETENTION_DELETE_BATCH
		) {
			await ctx.scheduler.runAfter(
				0,
				internal.boxes.boxMetrics.deleteOldSamples,
				{}
			);
		}
	}
});

export const rollupHourlyMetrics = internalMutation({
	args: {
		cursor: v.optional(v.string()),
		hourStart: v.optional(v.number()),
		statusIndex: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const hourStart =
			args.hourStart ?? Math.floor(Date.now() / HOUR_MS) * HOUR_MS - HOUR_MS;
		const statusIndex = args.statusIndex ?? 0;
		const status = ROLLUP_BOX_STATUSES[statusIndex];
		if (!status) return;

		const page = await ctx.db
			.query("boxes")
			.withIndex("status", (query) => query.eq("status", status))
			.paginate({ cursor: args.cursor ?? null, numItems: ROLLUP_BOX_BATCH });

		for (const box of page.page) {
			const existing = await ctx.db
				.query("box_metrics_hourly")
				.withIndex("box_id_hour_start", (query) =>
					query.eq("box_id", box._id).eq("hour_start", hourStart)
				)
				.first();
			if (existing) continue;

			const samples = await ctx.db
				.query("box_metrics")
				.withIndex("box_id_sampled_at", (query) =>
					query
						.eq("box_id", box._id)
						.gte("sampled_at", hourStart)
						.lt("sampled_at", hourStart + HOUR_MS)
				)
				.take(ROLLUP_SAMPLE_LIMIT);
			if (samples.length === 0) continue;

			const means = rollupMetricMeans(samples);

			await ctx.db.insert("box_metrics_hourly", {
				box_id: box._id,
				hour_start: hourStart,
				sample_count: samples.length,
				...means
			});
		}

		if (!page.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.boxes.boxMetrics.rollupHourlyMetrics,
				{ cursor: page.continueCursor, hourStart, statusIndex }
			);
			return;
		}

		if (statusIndex + 1 < ROLLUP_BOX_STATUSES.length) {
			await ctx.scheduler.runAfter(
				0,
				internal.boxes.boxMetrics.rollupHourlyMetrics,
				{ hourStart, statusIndex: statusIndex + 1 }
			);
		}
	}
});
