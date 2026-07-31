import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
	FLAG_COOLOFF_MS,
	boxMetricsSamples,
	rollupMetricMeans,
	type RollupMetricSample
} from "@/convex/boxes/metrics";

import {
	seedBox,
	seedSettings,
	stubDeploymentEnv,
	testConvex,
	type Harness
} from "../../../support/convex.ts";

function sample(value: number): RollupMetricSample {
	return {
		cpu_percent: value,
		ingress_bps: value + 1,
		egress_bps: value + 2,
		ingress_pps: value + 3,
		egress_pps: value + 4,
		disk_read_bps: value + 5,
		disk_write_bps: value + 6
	};
}

describe("rollupMetricMeans", () => {
	test("averages every rolled metric independently", () => {
		expect(rollupMetricMeans([sample(10), sample(20)])).toEqual({
			cpu_percent: 15,
			ingress_bps: 16,
			egress_bps: 17,
			ingress_pps: 18,
			egress_pps: 19,
			disk_read_bps: 20,
			disk_write_bps: 21
		});
	});

	test("does not mutate input samples", () => {
		const samples = [sample(1), sample(2)];
		const before = structuredClone(samples);

		rollupMetricMeans(samples);

		expect(samples).toEqual(before);
	});
});

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
	cpu_percent: 1,
	ingress_bps: 1,
	egress_bps: 1,
	ingress_pps: 1,
	egress_pps: 1,
	disk_read_bps: 1,
	disk_write_bps: 1
};

// Which table a range reads from.
//
// Raw samples are kept for two days and rolled up hourly for thirty, so a range
// longer than the raw window has to read the rollups or it silently returns a
// truncated series - a 30-day chart showing two days of data and no gap.
describe("the window a metrics range reads", () => {
	async function seedBoth(t: Harness, boxId: Id<"boxes">) {
		await t.run(async (ctx) => {
			await ctx.db.insert("box_metrics", {
				...READING,
				box_id: boxId,
				sampled_at: NOW - HOUR
			});
			await ctx.db.insert("box_metrics_hourly", {
				...READING,
				cpu_percent: 99,
				box_id: boxId,
				hour_start: NOW - 3 * 24 * HOUR,
				sample_count: 6
			});
		});
	}

	test("reads raw samples for a short range", async () => {
		const t = testConvex();
		await seedSettings(t);
		const boxId = await seedBox(t, { user_id: "owner" });
		await seedBoth(t, boxId);

		const samples = await t.run((ctx) => boxMetricsSamples(ctx, boxId, "1h"));

		expect(samples).toHaveLength(1);
		expect(samples[0]?.cpuPercent).toBe(1);
	});

	// Three days back: past the raw retention entirely, so only the rollup can
	// answer.
	test("reads the hourly rollups for a range longer than raw retention", async () => {
		const t = testConvex();
		await seedSettings(t);
		const boxId = await seedBox(t, { user_id: "owner" });
		await seedBoth(t, boxId);

		const samples = await t.run((ctx) => boxMetricsSamples(ctx, boxId, "30d"));

		expect(samples).toHaveLength(1);
		expect(samples[0]?.cpuPercent).toBe(99);
	});

	test("defaults to the raw window when no range is asked for", async () => {
		const t = testConvex();
		await seedSettings(t);
		const boxId = await seedBox(t, { user_id: "owner" });
		await seedBoth(t, boxId);

		const samples = await t.run((ctx) => boxMetricsSamples(ctx, boxId));

		expect(samples).toHaveLength(1);
		expect(samples[0]?.cpuPercent).toBe(1);
	});
});

// A box that stays over a threshold is still over it on the next poll, so the
// same signal would open a flag every ten minutes. The cooloff is what keeps one
// sustained problem to one flag - staff act on flags, and a hundred rows for one
// box is the same as none.
describe("the repeat-flag cooloff", () => {
	// Flags are evaluated as each sample is recorded, so driving the real
	// mutation is what exercises the cooloff.
	async function pollOverThreshold(t: Harness, boxId: Id<"boxes">) {
		for (let index = 0; index < 6; index += 1) {
			await t.mutation(internal.boxes.metrics.recordSample, {
				boxId,
				cpuPercent: 1,
				ingressBps: 1,
				egressBps: 500_000_000,
				ingressPps: 1,
				egressPps: 1,
				diskReadBps: 1,
				diskWriteBps: 1
			});
		}
	}

	async function flagCount(t: Harness) {
		return (await t.run((ctx) => ctx.db.query("box_flags").collect())).length;
	}

	test("opens one flag for a sustained crossing, not one per poll", async () => {
		const t = testConvex();
		await seedSettings(t);
		const boxId = await seedBox(t, { user_id: "owner" });

		await pollOverThreshold(t, boxId);
		const first = await flagCount(t);
		vi.setSystemTime(NOW + FLAG_COOLOFF_MS - 1);
		await pollOverThreshold(t, boxId);

		expect(first).toBeGreaterThan(0);
		expect(await flagCount(t)).toBe(first);
	});

	test("flags again once the cooloff has elapsed", async () => {
		const t = testConvex();
		await seedSettings(t);
		const boxId = await seedBox(t, { user_id: "owner" });

		await pollOverThreshold(t, boxId);
		const first = await flagCount(t);
		vi.setSystemTime(NOW + FLAG_COOLOFF_MS);
		await pollOverThreshold(t, boxId);

		expect(await flagCount(t)).toBeGreaterThan(first);
	});
});
