import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { internal } from "@/convex/_generated/api";

import {
	seedSettings,
	stubDeploymentEnv,
	testConvex
} from "../../support/convex.ts";

// The deployment's one settings row, and who is on record for its current state.
//
// `updated_by` is the only trace that a threshold, snapshot policy or reservation
// limit was ever changed - unlike the checkout and capacity toggles, those raise
// no alert - so a write that quietly clears it leaves the console reporting a
// deployment nobody configured.

const NOW = Date.UTC(2026, 6, 30, 12, 0, 0);
const AN_HOUR_EARLIER = NOW - 60 * 60 * 1000;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	stubDeploymentEnv();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe("the settings audit stamp", () => {
	test("names the staff member who made the change", async () => {
		const t = testConvex();
		await seedSettings(t);

		await t.mutation(internal.settings.setMaxActiveCheckoutIntentsPerUser, {
			max: 7,
			updatedBy: "clerk_admin"
		});

		expect(
			await t.run((ctx) => ctx.db.query("settings").first())
		).toMatchObject({
			max_active_checkout_intents_per_user: 7,
			updated_at: NOW,
			updated_by: "clerk_admin"
		});
	});

	// The hourly release refresh is a machine write against the same row. Passing
	// its absent actor through to `db.patch` deleted `updated_by` outright - Convex
	// removes a field it is given as `undefined` - and reset `updated_at`, so the
	// record of the last staff edit was never more than an hour old and never
	// named anybody.
	test("survives the hourly runtime release refresh", async () => {
		const t = testConvex();
		await seedSettings(t, {
			updated_at: AN_HOUR_EARLIER,
			updated_by: "clerk_admin"
		});

		await t.mutation(internal.settings.recordRuntimeRelease, {
			image: "ghcr.io/example/composery@sha256:abc",
			version: "1.2.3"
		});

		expect(
			await t.run((ctx) => ctx.db.query("settings").first())
		).toMatchObject({
			runtime_release: { version: "1.2.3" },
			updated_at: AN_HOUR_EARLIER,
			updated_by: "clerk_admin"
		});
	});
});
