import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { components, internal } from "@/convex/_generated/api";

import {
	boxOperations,
	readBox,
	seedBox,
	seedUser,
	staffAlerts,
	stubDeploymentEnv,
	testConvex,
	type Harness
} from "../../../support/convex.ts";

// Reconciliation is the backstop for Polar's webhooks: whatever the webhooks
// missed, this sweep notices by asking Polar directly. It is the only thing
// standing between a cancelled subscription and a box that keeps running - and,
// pointed the wrong way, the only thing that could tear down a box someone is
// still paying for. Both directions are tested.
const NOW = Date.UTC(2026, 9, 10, 11, 12, 13);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	stubDeploymentEnv();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

// Written through the Polar component's own mutation rather than into its
// tables, so the row is shaped the way the component would have shaped it.
async function seedSubscription(
	t: Harness,
	id: string,
	overrides: { endedAt?: string | null; status?: string } = {}
) {
	await t.mutation(components.polar.lib.updateSubscription, {
		subscription: {
			id,
			customerId: "cus_1",
			createdAt: new Date(NOW - 1000).toISOString(),
			modifiedAt: null,
			amount: 1000,
			currency: "usd",
			recurringInterval: "month",
			status: overrides.status ?? "active",
			currentPeriodStart: new Date(NOW - 1000).toISOString(),
			currentPeriodEnd: new Date(NOW + 1000).toISOString(),
			cancelAtPeriodEnd: false,
			startedAt: new Date(NOW - 1000).toISOString(),
			endedAt: overrides.endedAt ?? null,
			productId: "prod_box",
			checkoutId: null,
			metadata: {}
		}
	});
}

async function sweep(t: Harness) {
	await t.action(
		internal.billing.reconciliation.deleteBoxesWithoutActiveSubscriptions,
		{}
	);
}

describe("reconciling boxes against Polar", () => {
	test("leaves a box whose subscription is still active alone", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			polar_subscription_id: "sub_live",
			status: "running"
		});
		await seedSubscription(t, "sub_live", { status: "active" });

		await sweep(t);

		expect(await readBox(t, boxId)).toMatchObject({ status: "running" });
		expect(await boxOperations(t, boxId)).toEqual([]);
	});

	test.each(["canceled", "revoked", "unpaid"])(
		"tears down a box whose subscription is %s",
		async (status) => {
			const t = testConvex();
			const owner = await seedUser(t);
			const boxId = await seedBox(t, {
				user_id: owner.clerkUserId,
				polar_subscription_id: `sub_${status}`,
				status: "running"
			});
			await seedSubscription(t, `sub_${status}`, { status });

			await sweep(t);

			expect(await readBox(t, boxId)).toMatchObject({ status: "deleting" });
		}
	);

	// A subscription can end without its status saying so, so the end date is
	// checked as well as the word.
	test("tears down a box whose subscription has already ended", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			polar_subscription_id: "sub_ended",
			status: "running"
		});
		await seedSubscription(t, "sub_ended", {
			status: "active",
			endedAt: new Date(NOW - 1).toISOString()
		});

		await sweep(t);

		expect(await readBox(t, boxId)).toMatchObject({ status: "deleting" });
	});

	test("leaves a box whose subscription ends in the future alone", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			polar_subscription_id: "sub_ending",
			status: "running"
		});
		await seedSubscription(t, "sub_ending", {
			status: "active",
			endedAt: new Date(NOW + 60_000).toISOString()
		});

		await sweep(t);

		expect(await readBox(t, boxId)).toMatchObject({ status: "running" });
	});

	// The failure that matters most. A comp is backed by no subscription at all,
	// so "no active subscription" is its normal state - a sweep that read that as
	// grounds for deletion would delete every comped box on its first run.
	test("never tears down a comped box, which has no subscription by design", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			comped_at: NOW - 1000,
			comped_by: "admin",
			status: "running"
		});

		await sweep(t);

		expect(await readBox(t, boxId)).toMatchObject({ status: "running" });
		expect(await boxOperations(t, boxId)).toEqual([]);
	});

	// Polar not knowing about a subscription is not the same as Polar saying it
	// was cancelled, and the difference is somebody's files.
	test("leaves a box alone when Polar has no record of its subscription", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			polar_subscription_id: "sub_unknown",
			status: "running"
		});

		await sweep(t);

		expect(await readBox(t, boxId)).toMatchObject({ status: "running" });
	});

	test("does not start a second teardown for a box already being deleted", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			polar_subscription_id: "sub_gone",
			status: "deleting"
		});
		await seedSubscription(t, "sub_gone", { status: "revoked" });

		await sweep(t);

		expect(await boxOperations(t, boxId)).toEqual([]);
	});

	// One box that cannot be torn down must not stop the sweep reaching the rest
	// of the fleet - the next box in the page is somebody else's bill.
	test("keeps sweeping past a box it could not act on", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const busy = await seedBox(t, {
			user_id: owner.clerkUserId,
			slug: "busy",
			polar_subscription_id: "sub_busy",
			status: "running"
		});
		await t.run(
			async (ctx) =>
				await ctx.db.insert("box_operations", {
					box_id: busy,
					type: "repair",
					status: "running",
					idempotency_key: `repair:${busy}`,
					trigger: "owner",
					created_at: NOW - 1000,
					updated_at: NOW - 1000
				})
		);
		const free = await seedBox(t, {
			user_id: owner.clerkUserId,
			slug: "free",
			polar_subscription_id: "sub_free",
			status: "running"
		});
		await seedSubscription(t, "sub_busy", { status: "revoked" });
		await seedSubscription(t, "sub_free", { status: "revoked" });

		await sweep(t);

		expect(await readBox(t, busy)).toMatchObject({ status: "running" });
		expect(await readBox(t, free)).toMatchObject({ status: "deleting" });
	});

	test("raises no staff alert on a clean run", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		await seedBox(t, {
			user_id: owner.clerkUserId,
			polar_subscription_id: "sub_live",
			status: "running"
		});
		await seedSubscription(t, "sub_live");

		await sweep(t);

		expect(await staffAlerts(t)).toEqual([]);
	});
});
