import { v } from "convex/values";
import { query, type QueryCtx } from "../_generated/server";
import { requireStaff } from "../authorization";
import type { BoxStatus } from "../schema";

const COUNT_CAP = 1_000;
const DAILY_COUNT_CAP = 1_000;
const INTENT_COUNT_CAP = 5_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type StatsRange = "7d" | "30d" | "90d";

export const vStatsRange = v.union(
	v.literal("7d"),
	v.literal("30d"),
	v.literal("90d")
);

const RANGE_DAYS: Record<StatsRange, number> = {
	"7d": 7,
	"30d": 30,
	"90d": 90
};

type CappedCount = {
	capped: boolean;
	value: number;
};

const ACTIVE_STATUSES: BoxStatus[] = [
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

const FAILED_STATUSES: BoxStatus[] = [
	"provisioning_failed",
	"reset_failed",
	"restore_failed",
	"delete_failed"
];

function cappedCount(rowCount: number, cap: number): CappedCount {
	return {
		capped: rowCount > cap,
		value: Math.min(rowCount, cap)
	};
}

function sumCapped(counts: Iterable<CappedCount>): CappedCount {
	let capped = false;
	let value = 0;
	for (const count of counts) {
		capped ||= count.capped;
		value += count.value;
	}
	return { capped, value };
}

async function countByStatus(ctx: QueryCtx, status: BoxStatus) {
	const rows = await ctx.db
		.query("boxes")
		.withIndex("status", (q) => q.eq("status", status))
		.take(COUNT_CAP + 1);
	return cappedCount(rows.length, COUNT_CAP);
}

async function countUsersCreatedBetween(
	ctx: QueryCtx,
	start: number,
	end: number
) {
	const rows = await ctx.db
		.query("users")
		.withIndex("created_at", (q) =>
			q.gte("created_at", start).lt("created_at", end)
		)
		.take(DAILY_COUNT_CAP + 1);
	return cappedCount(rows.length, DAILY_COUNT_CAP);
}

async function countBoxesCreatedBetween(
	ctx: QueryCtx,
	start: number,
	end: number
) {
	const rows = await ctx.db
		.query("boxes")
		.withIndex("created_at", (q) =>
			q.gte("created_at", start).lt("created_at", end)
		)
		.take(DAILY_COUNT_CAP + 1);
	return cappedCount(rows.length, DAILY_COUNT_CAP);
}

async function countIntentsSince(ctx: QueryCtx, since: number) {
	const rows = await ctx.db
		.query("box_checkout_intents")
		.withIndex("created_at", (q) => q.gte("created_at", since))
		.take(INTENT_COUNT_CAP + 1);
	return cappedCount(rows.length, INTENT_COUNT_CAP);
}

async function countConvertedIntentsSince(ctx: QueryCtx, since: number) {
	const rows = await ctx.db
		.query("box_checkout_intents")
		.withIndex("status_created_at", (q) =>
			q.eq("status", "converted").gte("created_at", since)
		)
		.take(INTENT_COUNT_CAP + 1);
	return cappedCount(rows.length, INTENT_COUNT_CAP);
}

export const overview = query({
	args: {
		range: v.optional(vStatsRange)
	},
	handler: async (ctx, args) => {
		await requireStaff(ctx);

		const windowDays = RANGE_DAYS[args.range ?? "30d"];
		const now = Date.now();
		const since = now - windowDays * DAY_MS;
		const today = Math.floor(now / DAY_MS) * DAY_MS;

		const statusCounts = {} as Record<BoxStatus, CappedCount>;
		for (const status of ACTIVE_STATUSES) {
			statusCounts[status] = await countByStatus(ctx, status);
		}
		const activeBoxes = sumCapped(
			ACTIVE_STATUSES.map((status) => statusCounts[status])
		);
		const failedBoxes = sumCapped(
			FAILED_STATUSES.map((status) => statusCounts[status])
		);

		const series = [];
		for (let index = 0; index < windowDays; index += 1) {
			const at = today - (windowDays - 1 - index) * DAY_MS;
			const signups = await countUsersCreatedBetween(ctx, at, at + DAY_MS);
			const boxes = await countBoxesCreatedBetween(ctx, at, at + DAY_MS);
			series.push({
				at,
				signups: signups.value,
				signupsCapped: signups.capped,
				boxes: boxes.value,
				boxesCapped: boxes.capped
			});
		}

		const windowSignups = sumCapped(
			series.map((row) => ({ capped: row.signupsCapped, value: row.signups }))
		);
		const windowNewBoxes = sumCapped(
			series.map((row) => ({ capped: row.boxesCapped, value: row.boxes }))
		);
		const totalIntents = await countIntentsSince(ctx, since);
		const convertedIntents = await countConvertedIntentsSince(ctx, since);

		return {
			activeBoxes: activeBoxes.value,
			activeBoxesCapped: activeBoxes.capped,
			runningBoxes: statusCounts.running.value,
			runningBoxesCapped: statusCounts.running.capped,
			suspendedBoxes: statusCounts.suspended.value,
			suspendedBoxesCapped: statusCounts.suspended.capped,
			failedBoxes: failedBoxes.value,
			failedBoxesCapped: failedBoxes.capped,
			windowSignups: windowSignups.value,
			windowSignupsCapped: windowSignups.capped,
			windowNewBoxes: windowNewBoxes.value,
			windowNewBoxesCapped: windowNewBoxes.capped,
			totalIntents: totalIntents.value,
			totalIntentsCapped: totalIntents.capped,
			convertedIntents: convertedIntents.value,
			convertedIntentsCapped: convertedIntents.capped,
			conversionRate: totalIntents.value
				? convertedIntents.value / totalIntents.value
				: 0,
			conversionRateCapped: totalIntents.capped || convertedIntents.capped,
			windowDays,
			series
		};
	}
});
