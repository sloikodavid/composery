import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { internal } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

import {
	boxOperations,
	seedSettings,
	seedUser,
	stubDeploymentEnv,
	testConvex,
	type Harness
} from "../../../support/convex.ts";

// The one mutation that turns money into a box. It is reached only from
// `order.paid`, so by the time it runs a customer has been charged and every
// path out of it either provisions what they bought or gives the money back -
// there is no third option, and the plan it provisions has to be the one the
// order was actually paid against.
const NOW = Date.UTC(2026, 6, 28, 9, 0, 0);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	stubDeploymentEnv();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

async function seedIntent(
	t: Harness,
	userId: string,
	overrides: Partial<{
		plan: "air" | "pro";
		release_reason: string;
		status: "active" | "released" | "expired";
	}> = {}
) {
	return await t.run(
		async (ctx) =>
			await ctx.db.insert("box_checkout_intents", {
				user_id: userId,
				slug: "mine",
				plan: overrides.plan ?? "air",
				status: overrides.status ?? "active",
				release_reason: overrides.release_reason,
				created_at: NOW - 1000,
				updated_at: NOW - 1000
			})
	);
}

async function convert(
	t: Harness,
	intentId: Id<"box_checkout_intents">,
	plan: "air" | "pro"
) {
	return await t.mutation(
		internal.checkout.checkoutConversion.convertCheckoutIntentToBox,
		{
			intentId,
			plan,
			polarCustomerId: "cus_1",
			polarOrderId: "order_1",
			polarSubscriptionId: "sub_1",
			runtimeImage: "ghcr.io/example/composery@sha256:abc"
		}
	);
}

describe("converting a paid checkout into a box", () => {
	test("creates the box on the plan the order was paid against", async () => {
		const t = testConvex();
		await seedSettings(t);
		const owner = await seedUser(t);
		// Reserved as Air, paid as Pro. The money decides, because the machine the
		// customer gets has to be the one they were charged for.
		const intentId = await seedIntent(t, owner.clerkUserId, { plan: "air" });

		const result = await convert(t, intentId, "pro");

		expect(result.unfulfilled).toBeNull();
		expect(result.boxId).not.toBeNull();
		const box = await t.run(async (ctx) => await ctx.db.get(result.boxId!));
		expect(box).toMatchObject({
			plan: "pro",
			slug: "mine",
			status: "creating",
			polar_subscription_id: "sub_1"
		});
	});

	test("starts provisioning and converts the intent", async () => {
		const t = testConvex();
		await seedSettings(t);
		const owner = await seedUser(t);
		const intentId = await seedIntent(t, owner.clerkUserId);

		const result = await convert(t, intentId, "air");

		expect(await boxOperations(t, result.boxId!)).toMatchObject([
			{ type: "create", status: "pending", trigger: "owner" }
		]);
		const intent = await t.run(async (ctx) => await ctx.db.get(intentId));
		expect(intent).toMatchObject({
			status: "converted",
			box_id: result.boxId
		});
	});

	// A re-delivered webhook must not buy the customer a second box.
	test("returns the same box for a webhook delivered twice", async () => {
		const t = testConvex();
		await seedSettings(t);
		const owner = await seedUser(t);
		const intentId = await seedIntent(t, owner.clerkUserId);

		const first = await convert(t, intentId, "air");
		const second = await convert(t, intentId, "air");

		expect(second.boxId).toEqual(first.boxId);
		expect(second.unfulfilled).toBeNull();
		expect(await boxOperations(t, first.boxId!)).toHaveLength(1);
	});

	// The slug is the product's identity, so a sale that cannot deliver it is
	// refunded rather than fulfilled under a name the customer did not choose.
	test("refunds rather than renaming when the slug was taken meanwhile", async () => {
		const t = testConvex();
		await seedSettings(t);
		const owner = await seedUser(t);
		const other = await seedUser(t, {
			clerkUserId: "other",
			email: "other@example.com"
		});
		const intentId = await seedIntent(t, owner.clerkUserId);
		await t.run(async (ctx) => {
			await ctx.db.insert("boxes", {
				user_id: other.clerkUserId,
				slug: "mine",
				plan: "air",
				manual_snapshot_cap: 0,
				status: "running",
				created_at: NOW - 500,
				updated_at: NOW - 500
			});
		});

		const result = await convert(t, intentId, "air");

		expect(result.boxId).toBeNull();
		expect(result.unfulfilled).toMatchObject({
			orderId: "order_1",
			subscriptionId: "sub_1"
		});
	});

	// A terminal release must never be resurrected by a late webhook.
	test("refunds a checkout already released for a slug conflict", async () => {
		const t = testConvex();
		await seedSettings(t);
		const owner = await seedUser(t);
		const intentId = await seedIntent(t, owner.clerkUserId, {
			release_reason: "slug_conflict",
			status: "released"
		});

		const result = await convert(t, intentId, "air");

		expect(result.boxId).toBeNull();
		expect(result.unfulfilled).toMatchObject({
			idempotencyKey: `slug-conflict:${intentId}`
		});
	});
});
