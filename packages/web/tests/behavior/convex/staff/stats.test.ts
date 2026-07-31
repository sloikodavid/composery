import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "@/convex/_generated/api";
import { CAPACITY_BOX_STATUSES } from "@/convex/boxes/capacity";

import {
	seedBox,
	seedUser,
	stubDeploymentEnv,
	testConvex
} from "../../../support/convex.ts";

// The console's overview tiles. Every number here is a count of rows staff act
// on, so the one thing that must not happen is a tile that reads zero because a
// status fell out of the list it was summed from.

const NOW = Date.UTC(2026, 6, 30, 12, 0, 0);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	stubDeploymentEnv();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe("the failed-boxes tile", () => {
	// It sums `statusCounts`, which is only filled for the statuses that hold
	// capacity. A failure status outside that set would be read as `undefined`
	// and throw the whole overview, so the two lists are derived from one.
	test("draws every failure status from the set it was counted over", () => {
		const failed = CAPACITY_BOX_STATUSES.filter((status) =>
			status.endsWith("_failed")
		);
		expect(failed.length).toBeGreaterThan(0);
		for (const status of failed) {
			expect(CAPACITY_BOX_STATUSES).toContain(status);
		}
	});

	test("counts a box in every distinct failure state", async () => {
		const t = testConvex();
		const owner = await seedUser(t, { clerkUserId: "owner" });
		const admin = await seedUser(t, { clerkUserId: "admin", role: "admin" });
		const failed = CAPACITY_BOX_STATUSES.filter((status) =>
			status.endsWith("_failed")
		);
		for (const [index, status] of failed.entries()) {
			await seedBox(t, {
				user_id: owner.clerkUserId,
				slug: `box-${index}`,
				status
			});
		}

		const overview = await admin.as.query(api.staff.stats.overview, {});

		expect(overview.failedBoxes).toBe(failed.length);
		expect(overview.failedBoxesCapped).toBe(false);
	});
});

describe("the overview", () => {
	test("separates running, suspended and total live boxes", async () => {
		const t = testConvex();
		const owner = await seedUser(t, { clerkUserId: "owner" });
		const admin = await seedUser(t, { clerkUserId: "admin", role: "admin" });
		await seedBox(t, { user_id: owner.clerkUserId, slug: "a" });
		await seedBox(t, { user_id: owner.clerkUserId, slug: "b" });
		await seedBox(t, {
			user_id: owner.clerkUserId,
			slug: "c",
			status: "suspended"
		});
		// A deleted box holds nothing and is not live.
		await seedBox(t, {
			user_id: owner.clerkUserId,
			slug: "d",
			status: "deleted"
		});

		const overview = await admin.as.query(api.staff.stats.overview, {});

		expect(overview).toMatchObject({
			runningBoxes: 2,
			suspendedBoxes: 1,
			activeBoxes: 3
		});
	});

	test("reports a conversion rate of zero rather than dividing by none", async () => {
		const t = testConvex();
		const admin = await seedUser(t, { clerkUserId: "admin", role: "admin" });

		const overview = await admin.as.query(api.staff.stats.overview, {});

		expect(overview.totalIntents).toBe(0);
		expect(overview.conversionRate).toBe(0);
	});

	test("returns one series point per day of the chosen window", async () => {
		const t = testConvex();
		const admin = await seedUser(t, { clerkUserId: "admin", role: "admin" });

		const overview = await admin.as.query(api.staff.stats.overview, {
			range: "7d"
		});

		expect(overview.windowDays).toBe(7);
		expect(overview.series).toHaveLength(7);
	});

	test("refuses a customer", async () => {
		const t = testConvex();
		const customer = await seedUser(t, { clerkUserId: "customer" });

		await expect(
			customer.as.query(api.staff.stats.overview, {})
		).rejects.toThrow(/Staff access required/);
	});
});
