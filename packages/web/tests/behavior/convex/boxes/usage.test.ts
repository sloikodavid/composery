import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { internal } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { usageAlertKey, usageCrossing } from "@/convex/boxes/usage";
import { USAGE_FULL_STEP, USAGE_STEPS } from "@/convex/model/box/usage";
import { BOX_PLANS } from "@/convex/model/box/plan";

import {
	boxEvents,
	seedBox,
	seedUser,
	staffAlerts,
	stubDeploymentEnv,
	testConvex,
	type Harness
} from "../../../support/convex.ts";

// What a box has spent of what it is allowed, and who is told.
//
// The property worth protecting is not that a warning is sent - it is that it is
// sent once. A meter is read every ten minutes for traffic and every hour for a
// disk, and a box that sits at 90% sits there for days: a rule that mailed on
// every reading would put a stack of identical emails in an owner's inbox and
// teach them that mail from Composery is noise. So most of this file is about
// silence.

const NOW = Date.UTC(2026, 7, 2, 8, 0, 0);
const TERABYTE = 1_000 ** 4;
const ALLOWANCE = BOX_PLANS.air.trafficTb * TERABYTE;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	stubDeploymentEnv();
	vi.stubEnv("RESEND_API_KEY", "re_test");
	vi.stubEnv("RESEND_NOTICES_FROM", "Composery <notices@composery.test>");
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

async function ownedBox(t: Harness) {
	const owner = await seedUser(t);
	return await seedBox(t, { user_id: owner.clerkUserId, status: "running" });
}

function traffic(t: Harness, boxId: Id<"boxes">, percent: number) {
	return t.mutation(internal.boxes.usage.recordTrafficUsage, {
		boxId,
		outgoingBytes: Math.round((ALLOWANCE * percent) / 100),
		providerIncludedBytes: ALLOWANCE
	});
}

function disk(
	t: Harness,
	boxId: Id<"boxes">,
	usedBytes: number,
	totalBytes = 40_000_000_000
) {
	return t.mutation(internal.boxes.usage.recordDiskUsage, {
		boxId,
		usedBytes,
		totalBytes
	});
}

function usageRows(t: Harness, boxId: Id<"boxes">) {
	return t.run(
		async (ctx) =>
			await ctx.db
				.query("box_usage")
				.withIndex("box_id_signal", (query) => query.eq("box_id", boxId))
				.collect()
	);
}

async function usageEmails(t: Harness, boxId: Id<"boxes">) {
	const events = await boxEvents(t, boxId);
	return events
		.filter(
			(event) =>
				event.type === "box.owner_emailed" && event.metadata?.notice === "usage"
		)
		.map((event) => event.metadata?.signal);
}

describe("deciding whether a crossing is news", () => {
	// Pure, so the whole matrix is checkable without a database, a provider or a
	// clock - and every caller decides from this and nothing else.
	test("says nothing below the first step", () => {
		expect(usageCrossing(undefined, USAGE_STEPS[0] - 1)).toEqual({
			step: null,
			announce: false
		});
	});

	test("announces a step nobody has been told about", () => {
		expect(usageCrossing(undefined, USAGE_STEPS[0])).toEqual({
			step: USAGE_STEPS[0],
			announce: true
		});
	});

	test("stays quiet at a step already announced", () => {
		expect(usageCrossing(USAGE_STEPS[0], USAGE_STEPS[0])).toEqual({
			step: USAGE_STEPS[0],
			announce: false
		});
	});

	test("announces a higher step even after the first one", () => {
		expect(usageCrossing(USAGE_STEPS[0], 100)).toEqual({
			step: USAGE_FULL_STEP,
			announce: true
		});
	});

	// Falling back records the lower step rather than keeping the high-water mark,
	// which is what lets the same step be announced again next time it is crossed.
	test("records the drop, so the same step is news the next time", () => {
		expect(usageCrossing(USAGE_FULL_STEP, USAGE_STEPS[0])).toEqual({
			step: USAGE_STEPS[0],
			announce: false
		});
		expect(usageCrossing(USAGE_STEPS[0], 100)).toEqual({
			step: USAGE_FULL_STEP,
			announce: true
		});
	});
});

describe("recording a reading", () => {
	test("stores the two figures and derives nothing else", async () => {
		const t = testConvex();
		const boxId = await ownedBox(t);

		await disk(t, boxId, 10_000_000_000);

		expect(await usageRows(t, boxId)).toMatchObject([
			{
				signal: "disk",
				used_bytes: 10_000_000_000,
				allowance_bytes: 40_000_000_000,
				sampled_at: NOW
			}
		]);
	});

	test("keeps one row per signal, however often each is sampled", async () => {
		const t = testConvex();
		const boxId = await ownedBox(t);

		await disk(t, boxId, 1_000_000_000);
		await disk(t, boxId, 2_000_000_000);
		await traffic(t, boxId, 10);
		await traffic(t, boxId, 20);

		const rows = await usageRows(t, boxId);
		expect(rows).toHaveLength(2);
		expect(rows.map((row) => row.signal).sort()).toEqual(["disk", "traffic"]);
		expect(rows.find((row) => row.signal === "disk")?.used_bytes).toBe(
			2_000_000_000
		);
	});

	// The allowance is the plan's, and it is read on this side rather than passed
	// in: a caller that could name its own allowance is a caller that could measure
	// a box against a limit it was never sold.
	test("measures traffic against what the box's plan includes", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			plan: "pro",
			status: "running"
		});

		await traffic(t, boxId, 50);

		expect((await usageRows(t, boxId))[0]?.allowance_bytes).toBe(
			BOX_PLANS.pro.trafficTb * TERABYTE
		);
	});

	test("records nothing for a box that no longer exists", async () => {
		const t = testConvex();
		const boxId = await ownedBox(t);
		await t.run(async (ctx) => await ctx.db.delete(boxId));

		await expect(disk(t, boxId, 1)).resolves.toBeNull();
		expect(await usageRows(t, boxId)).toEqual([]);
	});
});

describe("telling the owner", () => {
	test("emails once when a step is first crossed", async () => {
		const t = testConvex();
		const boxId = await ownedBox(t);

		await traffic(t, boxId, USAGE_STEPS[0]);

		expect(await usageEmails(t, boxId)).toEqual(["traffic"]);
	});

	// The whole point. A box parked at 90% is read every ten minutes for as long
	// as it stays there.
	test("says nothing again while the level merely stays high", async () => {
		const t = testConvex();
		const boxId = await ownedBox(t);

		await traffic(t, boxId, USAGE_STEPS[0]);
		for (let poll = 0; poll < 5; poll += 1) {
			await traffic(t, boxId, USAGE_STEPS[0] + 1);
		}

		expect(await usageEmails(t, boxId)).toEqual(["traffic"]);
	});

	test("emails again once the next step is reached", async () => {
		const t = testConvex();
		const boxId = await ownedBox(t);

		await traffic(t, boxId, USAGE_STEPS[0]);
		await traffic(t, boxId, 100);

		expect(await usageEmails(t, boxId)).toEqual(["traffic", "traffic"]);
	});

	// The provider resets the traffic counter at the start of a billing month.
	// Nothing here knows the billing calendar; a counter that went down is the
	// signal, and that is what has to re-arm the warning for the new period.
	test("warns again in a new period, once the counter has reset", async () => {
		const t = testConvex();
		const boxId = await ownedBox(t);

		await traffic(t, boxId, 100);
		expect(await usageEmails(t, boxId)).toEqual(["traffic"]);

		await traffic(t, boxId, 2);
		const [reset] = await usageRows(t, boxId);
		// The mark is cleared, not lowered to zero: a step of zero would compare as
		// a step already announced and keep the whole period silent.
		expect(reset?.noticed_step).toBeUndefined();
		expect(reset?.counter_reset_at).toBe(NOW);

		await traffic(t, boxId, 100);
		expect(await usageEmails(t, boxId)).toEqual(["traffic", "traffic"]);
	});

	// A disk does not reset, so nothing marks one - and a reading that is simply
	// lower than the last is not a new period to warn about all over again.
	test("marks no reset for a disk that merely freed some space", async () => {
		const t = testConvex();
		const boxId = await ownedBox(t);

		await disk(t, boxId, 30_000_000_000);
		await disk(t, boxId, 29_000_000_000);

		expect((await usageRows(t, boxId))[0]?.counter_reset_at).toBe(NOW);
		expect(await usageEmails(t, boxId)).toEqual([]);
	});

	test("tells the two signals apart, so one warning does not cover both", async () => {
		const t = testConvex();
		const boxId = await ownedBox(t);

		await traffic(t, boxId, 100);
		await disk(t, boxId, 39_000_000_000);

		expect((await usageEmails(t, boxId)).sort()).toEqual(["disk", "traffic"]);
	});
});

describe("telling staff", () => {
	// Only the top step. The first is the owner's to act on, and there is nothing
	// a person here could do about it that the email has not already asked for.
	test("stays out of it at the first step", async () => {
		const t = testConvex();
		const boxId = await ownedBox(t);

		await traffic(t, boxId, USAGE_STEPS[0]);

		expect(await staffAlerts(t)).toEqual([]);
	});

	test("raises one alert when the allowance is effectively gone", async () => {
		const t = testConvex();
		const boxId = await ownedBox(t);

		await traffic(t, boxId, 100);

		expect(await staffAlerts(t)).toMatchObject([
			{
				key: usageAlertKey(boxId, "traffic", NOW),
				severity: "warning"
			}
		]);
	});

	// `raiseAlert` deduplicates by key for the life of the row, so a key with no
	// period in it would report a full disk once and stay silent through every
	// later month it stayed full.
	test("keys the alert by month, so a later period is heard", () => {
		const boxId = "box_1" as Id<"boxes">;
		expect(usageAlertKey(boxId, "disk", Date.UTC(2026, 7, 2))).not.toBe(
			usageAlertKey(boxId, "disk", Date.UTC(2026, 8, 2))
		);
		expect(usageAlertKey(boxId, "disk", Date.UTC(2026, 7, 2))).toBe(
			usageAlertKey(boxId, "disk", Date.UTC(2026, 7, 28))
		);
	});

	// The fault nothing else would notice: every box stays inside its published
	// allowance and the deployment is billed for excess anyway, because the
	// machine behind the plan includes less than the plan sells.
	test("reports a plan that sells more traffic than its machine includes", async () => {
		const t = testConvex();
		const boxId = await ownedBox(t);

		await t.mutation(internal.boxes.usage.recordTrafficUsage, {
			boxId,
			outgoingBytes: 1,
			providerIncludedBytes: ALLOWANCE - 1
		});

		expect(await staffAlerts(t)).toMatchObject([
			{ severity: "critical", subject: expect.stringContaining("Box Air") }
		]);
	});

	test("says nothing while the machine includes what the plan sells", async () => {
		const t = testConvex();
		const boxId = await ownedBox(t);

		await t.mutation(internal.boxes.usage.recordTrafficUsage, {
			boxId,
			outgoingBytes: 1,
			providerIncludedBytes: ALLOWANCE
		});

		expect(await staffAlerts(t)).toEqual([]);
	});
});
