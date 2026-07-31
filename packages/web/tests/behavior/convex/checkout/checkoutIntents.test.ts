import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "@/convex/_generated/api";
import {
	paidOrderRecordingStatus,
	reservationsToRelease
} from "@/convex/checkout/checkoutIntents";
import {
	seedSettings,
	stubDeploymentEnv,
	testConvex
} from "../../../support/convex";

const NOW = Date.UTC(2026, 6, 29, 10, 0, 0);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	stubDeploymentEnv();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

const paidOrder = {
	checkoutId: "checkout-new",
	orderId: "order-new",
	subscriptionId: "subscription-new"
};

describe("reservationsToRelease", () => {
	test("enforces a lowered cap against every live reservation before adding its replacement", async () => {
		const t = testConvex();
		await seedSettings(t, { max_active_checkout_intents_per_user: 1 });
		await t.run(async (ctx) => {
			for (let index = 0; index < 50; index++) {
				await ctx.db.insert("box_checkout_intents", {
					created_at: index,
					plan: "air",
					slug: `old-${index}`,
					status: "active",
					updated_at: index,
					user_id: "owner"
				});
			}
		});

		await t.mutation(internal.checkout.checkoutIntents.reserveCheckoutIntent, {
			plan: "air",
			slug: "replacement",
			userId: "owner"
		});

		const intents = await t.run(
			async (ctx) =>
				await ctx.db
					.query("box_checkout_intents")
					.withIndex("user_id_created_at", (query) =>
						query.eq("user_id", "owner")
					)
					.collect()
		);
		expect(
			intents
				.filter((intent) => intent.status === "released")
				.sort((left, right) => left.created_at - right.created_at)
				.map((intent) => [intent.slug, intent.release_reason])
		).toEqual(
			Array.from({ length: 50 }, (_, index) => [
				`old-${index}`,
				"superseded_by_new_reservation"
			])
		);
		expect(
			intents
				.filter((intent) => intent.status === "active")
				.map((intent) => intent.slug)
		).toEqual(["replacement"]);

		const lowered = testConvex();
		await seedSettings(lowered, {
			max_active_checkout_intents_per_user: 3
		});
		await lowered.run(async (ctx) => {
			for (let index = 0; index < 5; index++) {
				await ctx.db.insert("box_checkout_intents", {
					created_at: index,
					plan: "air",
					slug: `lowered-${index}`,
					status: "active",
					updated_at: index,
					user_id: "owner"
				});
			}
		});
		await lowered.mutation(
			internal.checkout.checkoutIntents.reserveCheckoutIntent,
			{
				plan: "air",
				slug: "lowered-replacement",
				userId: "owner"
			}
		);
		const loweredIntents = await lowered.run(
			async (ctx) =>
				await ctx.db
					.query("box_checkout_intents")
					.withIndex("user_id_created_at", (query) =>
						query.eq("user_id", "owner")
					)
					.collect()
		);
		expect(
			loweredIntents
				.filter((intent) => intent.status === "active")
				.map((intent) => intent.slug)
				.sort()
		).toEqual(["lowered-3", "lowered-4", "lowered-replacement"]);
	});

	test("keeps every reservation while there is room under the cap", () => {
		expect(reservationsToRelease(0, 3)).toBe(0);
		expect(reservationsToRelease(2, 3)).toBe(0);
	});

	test("releases the oldest reservation at the cap", () => {
		expect(reservationsToRelease(3, 3)).toBe(1);
	});

	test("works off a cap lowered below the live count", () => {
		expect(reservationsToRelease(5, 3)).toBe(3);
		expect(reservationsToRelease(50, 1)).toBe(50);
	});

	test("rejects corrupt settings and unbounded stored state", () => {
		expect(() => reservationsToRelease(-1, 3)).toThrow(/out of bounds/);
		expect(() => reservationsToRelease(1.5, 3)).toThrow(/out of bounds/);
		expect(() => reservationsToRelease(51, 3)).toThrow(/out of bounds/);
		expect(() => reservationsToRelease(3, 0)).toThrow(/out of bounds/);
		expect(() => reservationsToRelease(3, 1.5)).toThrow(/out of bounds/);
		expect(() => reservationsToRelease(3, 51)).toThrow(/out of bounds/);
		expect(reservationsToRelease(0, 50)).toBe(0);
	});
});

describe("paidOrderRecordingStatus", () => {
	test("reports a missing checkout intent", () => {
		expect(paidOrderRecordingStatus(null, paidOrder)).toBe("missing");
	});

	test("accepts a matching unfulfilled checkout", () => {
		expect(
			paidOrderRecordingStatus(
				{
					box_id: undefined,
					polar_checkout_id: "checkout-new",
					polar_initial_order_id: undefined,
					polar_subscription_id: undefined
				},
				paidOrder
			)
		).toBe("recorded");
	});

	test("rejects checkout metadata pointing at a different checkout", () => {
		expect(
			paidOrderRecordingStatus(
				{
					box_id: undefined,
					polar_checkout_id: "checkout-original",
					polar_initial_order_id: undefined,
					polar_subscription_id: undefined
				},
				paidOrder
			)
		).toBe("checkout_mismatch");
	});

	test("rejects a second paid identity on an existing intent", () => {
		expect(
			paidOrderRecordingStatus(
				{
					box_id: undefined,
					polar_checkout_id: "checkout-new",
					polar_initial_order_id: "order-original",
					polar_subscription_id: "subscription-original"
				},
				paidOrder
			)
		).toBe("order_mismatch");
	});

	test("allows an idempotent redelivery for an already fulfilled box", () => {
		expect(
			paidOrderRecordingStatus(
				{
					box_id: "box-id" as never,
					polar_checkout_id: "checkout-new",
					polar_initial_order_id: "order-new",
					polar_subscription_id: "subscription-new"
				},
				paidOrder
			)
		).toBe("already_fulfilled");
	});
});
