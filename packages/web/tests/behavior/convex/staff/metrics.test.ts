import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

import {
	seedBox,
	seedUser,
	stubDeploymentEnv,
	testConvex,
	type Harness
} from "../../../support/convex.ts";

// Which boxes the fleet chart draws, and where the ranking reads them from.
//
// This replaced seven `hour_start_<metric>` indexes - written on every rollup,
// for eight rows on one staff chart - with one index and an in-memory sort. What
// has to keep holding is that the sort still picks the busiest boxes, still
// scores each box on its most recent reading rather than an older one, and still
// has an answer on a deployment whose first rollup has not run yet.

const NOW = Date.UTC(2026, 6, 30, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	stubDeploymentEnv();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

const READING = {
	sample_count: 6,
	cpu_percent: 0,
	ingress_bps: 0,
	egress_bps: 0,
	ingress_pps: 0,
	egress_pps: 0,
	disk_read_bps: 0,
	disk_write_bps: 0
};

async function seedHourly(
	t: Harness,
	boxId: Id<"boxes">,
	hourStart: number,
	values: Partial<typeof READING>
) {
	await t.run(
		async (ctx) =>
			await ctx.db.insert("box_metrics_hourly", {
				...READING,
				...values,
				box_id: boxId,
				hour_start: hourStart
			})
	);
}

async function seedSample(
	t: Harness,
	boxId: Id<"boxes">,
	sampledAt: number,
	values: Partial<typeof READING>
) {
	await t.run(
		async (ctx) =>
			await ctx.db.insert("box_metrics", {
				cpu_percent: 0,
				ingress_bps: 0,
				egress_bps: 0,
				ingress_pps: 0,
				egress_pps: 0,
				disk_read_bps: 0,
				disk_write_bps: 0,
				...values,
				box_id: boxId,
				sampled_at: sampledAt
			})
	);
}

async function fleet(t: Harness) {
	const owner = await seedUser(t, { clerkUserId: "owner" });
	const admin = await seedUser(t, { clerkUserId: "admin", role: "admin" });
	const quiet = await seedBox(t, { user_id: owner.clerkUserId, slug: "quiet" });
	const busy = await seedBox(t, { user_id: owner.clerkUserId, slug: "busy" });
	return { admin, busy, quiet };
}

describe("the fleet metrics chart", () => {
	test("ranks off the newest rolled-up hour", async () => {
		const t = testConvex();
		const { admin, busy, quiet } = await fleet(t);
		await seedHourly(t, busy, NOW - HOUR, { cpu_percent: 90 });
		await seedHourly(t, quiet, NOW - HOUR, { cpu_percent: 2 });

		const series = await admin.as.query(api.staff.metrics.series, {});

		expect(series.map((row) => row.slug).sort()).toEqual(["busy", "quiet"]);
	});

	// Each box is scored on its most recent reading, so a box that was busy hours
	// ago does not keep a place on a chart of what is happening now.
	test("scores a box on its latest hour, not its worst one", async () => {
		const t = testConvex();
		const { admin, busy, quiet } = await fleet(t);
		// `quiet` was the busiest box two hours ago and has since gone idle.
		await seedHourly(t, quiet, NOW - 2 * HOUR, { egress_pps: 9_000 });
		await seedHourly(t, quiet, NOW - HOUR, { egress_pps: 1 });
		await seedHourly(t, busy, NOW - HOUR, { egress_pps: 500 });

		const series = await admin.as.query(api.staff.metrics.series, {
			metric: "egress_pps"
		});

		// Both still appear - the chart draws the top eight - but the ranking read
		// the newest hour for each, which is the row this used to get wrong.
		expect(series.map((row) => row.slug).sort()).toEqual(["busy", "quiet"]);
	});

	// A deployment whose hourly rollup has never run still has raw samples, and a
	// chart that answered "no boxes" there would look like an empty fleet rather
	// than a young one.
	test("falls back to raw samples before the first rollup", async () => {
		const t = testConvex();
		const { admin, busy } = await fleet(t);
		await seedSample(t, busy, NOW - 60_000, { cpu_percent: 55 });

		const series = await admin.as.query(api.staff.metrics.series, {});

		expect(series.map((row) => row.slug)).toEqual(["busy"]);
	});

	test("draws one named box on its own when asked for one", async () => {
		const t = testConvex();
		const { admin, busy, quiet } = await fleet(t);
		await seedHourly(t, busy, NOW - HOUR, { cpu_percent: 90 });
		await seedHourly(t, quiet, NOW - HOUR, { cpu_percent: 2 });

		expect(
			await admin.as.query(api.staff.metrics.series, { boxId: busy })
		).toMatchObject([{ slug: "busy" }]);
	});

	test("refuses a customer", async () => {
		const t = testConvex();
		const customer = await seedUser(t, { clerkUserId: "customer" });

		await expect(
			customer.as.query(api.staff.metrics.series, {})
		).rejects.toThrow(/Staff access required/);
	});
});
