import type { FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Polar's own API is the one thing here that cannot be exercised - revoking and
// refunding are outbound calls - so those two are stubbed and everything else is
// the real handler against a real deployment. What is asserted is the decision:
// which paid orders become boxes, which are handed back, and that none is
// silently dropped, because an `order.paid` this code ignores is a customer who
// has been charged and will never be told why nothing arrived.
const revokeAndRefundPolarOrder = vi.fn();
const revokePolarSubscription = vi.fn();
vi.mock("@/convex/billing/polar", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/convex/billing/polar")>();
	return { ...actual, revokeAndRefundPolarOrder, revokePolarSubscription };
});

const {
	handleClosedCheckout,
	handlePaidOrder,
	handleRefundedOrder,
	handleRevokedSubscription
} = await import("@/convex/billing/webhooks");
const { CHECKOUT_INTENT_METADATA_KEYS } =
	await import("@/convex/checkout/checkoutIntents");
// The real slug, because a fixture spelling it by hand would keep passing after
// the field was renamed in Polar and here.
const { TERMS_FIELD_SLUG } = await import("@/lib/cloud-legal");
const {
	boxOperations,
	readBox,
	seedBox,
	seedSettings,
	seedUser,
	staffAlerts,
	stubDeploymentEnv,
	testConvex
} = await import("../../../support/convex.ts");
type Harness = Awaited<
	ReturnType<typeof import("../../../support/convex.ts").testConvex>
>;

const NOW = Date.UTC(2026, 6, 30, 12, 0, 0);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	stubDeploymentEnv();
	vi.stubEnv("RUNTIME_IMAGE", "ghcr.io/example/composery@sha256:abc");
	revokeAndRefundPolarOrder.mockReset();
	revokePolarSubscription.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

// Polar dispatches its handlers with a context that can only run functions, so
// that is exactly what a test gives them. No `db`: a handler that reached for
// one would be doing work the webhook route cannot do.
function routeCtx(t: Harness) {
	return {
		runQuery: (reference: FunctionReference<"query">, args: never) =>
			t.query(reference, args),
		runMutation: (reference: FunctionReference<"mutation">, args: never) =>
			t.mutation(reference, args)
	} as unknown as Parameters<typeof handlePaidOrder>[0];
}

// Only the fields a handler reads. Written out rather than built from Polar's
// full Order so that adding a read to the handler shows up here as a missing
// field instead of passing on a fixture nobody checked.
function paidOrder(overrides: Record<string, unknown> = {}) {
	return {
		billingReason: "subscription_create",
		checkoutId: "checkout_1",
		createdAt: new Date(NOW - 1000),
		customFieldData: { [TERMS_FIELD_SLUG]: true },
		customerId: "cus_1",
		id: "order_1",
		metadata: {},
		productId: "air-monthly",
		subscription: { id: "sub_1" },
		...overrides
	} as unknown as Parameters<typeof handlePaidOrder>[1];
}

async function seedIntent(
	t: Harness,
	userId: string,
	overrides: Record<string, unknown> = {}
) {
	return await t.run(
		async (ctx) =>
			await ctx.db.insert("box_checkout_intents", {
				user_id: userId,
				slug: "mine",
				plan: "air",
				status: "active",
				polar_checkout_id: "checkout_1",
				created_at: NOW - 1000,
				updated_at: NOW - 1000,
				...overrides
			})
	);
}

describe("a paid Polar order", () => {
	test("provisions the box on the plan the order names", async () => {
		const t = testConvex();
		await seedSettings(t);
		const owner = await seedUser(t);
		const intentId = await seedIntent(t, owner.clerkUserId);

		await handlePaidOrder(routeCtx(t), paidOrder({ productId: "pro-annual" }));

		const intent = await t.run(async (ctx) => await ctx.db.get(intentId));
		expect(intent).toMatchObject({ status: "converted" });
		expect(await readBox(t, intent!.box_id!)).toMatchObject({
			plan: "pro",
			slug: "mine",
			status: "creating",
			polar_subscription_id: "sub_1"
		});
		expect(revokeAndRefundPolarOrder).not.toHaveBeenCalled();
		expect(await staffAlerts(t)).toEqual([]);
	});

	// The reservation is found by the intent id carried in checkout metadata as
	// well as by the checkout id, so a checkout Polar renumbered still converts.
	test("matches its reservation through checkout metadata", async () => {
		const t = testConvex();
		await seedSettings(t);
		const owner = await seedUser(t);
		const intentId = await seedIntent(t, owner.clerkUserId, {
			polar_checkout_id: undefined
		});

		await handlePaidOrder(
			routeCtx(t),
			paidOrder({
				metadata: { [CHECKOUT_INTENT_METADATA_KEYS.intentId]: intentId }
			})
		);

		expect(
			await t.run(async (ctx) => await ctx.db.get(intentId))
		).toMatchObject({ status: "converted" });
	});

	// A renewal bills a box that already exists. Reading it as a first payment
	// would provision a second one on the same subscription.
	test.each(["subscription_cycle", "subscription_update", "purchase"])(
		"ignores an order billed as %s",
		async (billingReason) => {
			const t = testConvex();
			await seedSettings(t);
			const owner = await seedUser(t);
			await seedIntent(t, owner.clerkUserId);

			await handlePaidOrder(routeCtx(t), paidOrder({ billingReason }));

			expect(
				await t.run(async (ctx) => await ctx.db.query("boxes").first())
			).toBeNull();
			expect(revokeAndRefundPolarOrder).not.toHaveBeenCalled();
			expect(await staffAlerts(t)).toEqual([]);
		}
	);

	// The failure this file exists for. An unconfigured or repointed product id
	// used to end the handler on its first line: the customer was charged, no box
	// was made, and nothing anywhere said so.
	test("refunds and reports an order for a product it does not sell", async () => {
		const t = testConvex();
		await seedSettings(t);
		const owner = await seedUser(t);
		await seedIntent(t, owner.clerkUserId);

		await handlePaidOrder(
			routeCtx(t),
			paidOrder({ productId: "prod_from_another_catalogue" })
		);

		expect(
			await t.run(async (ctx) => await ctx.db.query("boxes").first())
		).toBeNull();
		expect(revokeAndRefundPolarOrder).toHaveBeenCalledWith(
			expect.objectContaining({
				idempotencyKey: "unsellable-product:order_1",
				orderId: "order_1",
				subscriptionId: "sub_1"
			})
		);
		expect(await staffAlerts(t)).toMatchObject([
			{
				key: "unsellable-product:order_1",
				severity: "critical",
				subject: "Paid Polar order is for a product Composery does not sell"
			}
		]);
	});

	test("refunds and reports an order no reservation matches", async () => {
		const t = testConvex();
		await seedSettings(t);

		await handlePaidOrder(routeCtx(t), paidOrder());

		expect(revokeAndRefundPolarOrder).toHaveBeenCalledWith(
			expect.objectContaining({ idempotencyKey: "unmatched-checkout:order_1" })
		);
		expect(await staffAlerts(t)).toMatchObject([
			{ subject: "Paid Polar order is not linked to a checkout" }
		]);
	});

	// The supplier Terms checkbox is the acceptance evidence. Without it there is
	// no contract to fulfil, whatever was paid.
	test.each([{}, { [TERMS_FIELD_SLUG]: false }])(
		"refunds and reports an order whose Terms checkbox is %o",
		async (customFieldData) => {
			const t = testConvex();
			await seedSettings(t);
			const owner = await seedUser(t);
			await seedIntent(t, owner.clerkUserId);

			await handlePaidOrder(routeCtx(t), paidOrder({ customFieldData }));

			expect(
				await t.run(async (ctx) => await ctx.db.query("boxes").first())
			).toBeNull();
			expect(revokeAndRefundPolarOrder).toHaveBeenCalledWith(
				expect.objectContaining({ idempotencyKey: "missing-terms:order_1" })
			);
			expect(await staffAlerts(t)).toMatchObject([
				{ subject: "Paid Polar order is missing Terms acceptance" }
			]);
		}
	);

	// A reservation already carrying a different order is not this order's, so
	// recording would overwrite one sale's evidence with another's.
	test("refunds and reports an order that contradicts its reservation", async () => {
		const t = testConvex();
		await seedSettings(t);
		const owner = await seedUser(t);
		await seedIntent(t, owner.clerkUserId, {
			polar_initial_order_id: "order_earlier",
			polar_subscription_id: "sub_earlier"
		});

		await handlePaidOrder(routeCtx(t), paidOrder());

		expect(revokeAndRefundPolarOrder).toHaveBeenCalledWith(
			expect.objectContaining({
				idempotencyKey: "checkout-intent-mismatch:order_1"
			})
		);
		expect(await staffAlerts(t)).toMatchObject([
			{ subject: "Paid Polar order does not match its checkout intent" }
		]);
	});

	// Polar retries a webhook it did not get a 2xx for, so every one of these
	// arrives twice sooner or later.
	test("buys one box for a webhook delivered twice", async () => {
		const t = testConvex();
		await seedSettings(t);
		const owner = await seedUser(t);
		const intentId = await seedIntent(t, owner.clerkUserId);

		await handlePaidOrder(routeCtx(t), paidOrder());
		await handlePaidOrder(routeCtx(t), paidOrder());

		const boxes = await t.run(
			async (ctx) => await ctx.db.query("boxes").collect()
		);
		expect(boxes).toHaveLength(1);
		expect(await boxOperations(t, boxes[0]!._id)).toHaveLength(1);
		expect(revokeAndRefundPolarOrder).not.toHaveBeenCalled();
		expect(
			await t.run(async (ctx) => await ctx.db.get(intentId))
		).toMatchObject({ status: "converted" });
	});

	// Nothing to revoke means the automatic path cannot run at all, which is
	// precisely when a person has to be told rather than the event dropped.
	test("reports an order that opened no subscription without refunding blind", async () => {
		const t = testConvex();
		await seedSettings(t);

		await handlePaidOrder(routeCtx(t), paidOrder({ subscription: null }));

		expect(revokeAndRefundPolarOrder).not.toHaveBeenCalled();
		expect(await staffAlerts(t)).toMatchObject([
			{ subject: "Paid Polar order opened no subscription" }
		]);
	});
});

describe("a fully refunded order", () => {
	test("revokes the subscription behind it", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		await seedBox(t, {
			user_id: owner.clerkUserId,
			polar_subscription_id: "sub_1"
		});

		await handleRefundedOrder(
			routeCtx(t),
			paidOrder({ refundableAmount: 0, subscriptionId: "sub_1" })
		);

		expect(revokePolarSubscription).toHaveBeenCalledWith("sub_1");
	});

	// A partial refund is a price adjustment, not the end of the sale.
	test("leaves a partly refunded order alone", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		await seedBox(t, {
			user_id: owner.clerkUserId,
			polar_subscription_id: "sub_1"
		});

		await handleRefundedOrder(
			routeCtx(t),
			paidOrder({ refundableAmount: 500, subscriptionId: "sub_1" })
		);

		expect(revokePolarSubscription).not.toHaveBeenCalled();
	});

	test("releases a reservation that never became a box", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const intentId = await seedIntent(t, owner.clerkUserId);

		await handleRefundedOrder(
			routeCtx(t),
			paidOrder({ refundableAmount: 0, subscriptionId: "sub_1" })
		);

		expect(
			await t.run(async (ctx) => await ctx.db.get(intentId))
		).toMatchObject({
			release_reason: "order_fully_refunded",
			status: "released"
		});
	});
});

describe("a revoked subscription", () => {
	test("starts deleting the box it paid for", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			polar_subscription_id: "sub_1"
		});

		await handleRevokedSubscription(routeCtx(t), "sub_1");

		expect(await readBox(t, boxId)).toMatchObject({ status: "deleting" });
	});

	test("does nothing for a subscription no box is on", async () => {
		const t = testConvex();

		await expect(
			handleRevokedSubscription(routeCtx(t), "sub_unknown")
		).resolves.toBeUndefined();
	});
});

describe("a checkout that ended without paying", () => {
	test.each([
		["expired", "expired", "checkout_expired"],
		["failed", "released", "checkout_failed"]
	])(
		"releases the reservation behind a %s checkout",
		async (status, intentStatus, reason) => {
			const t = testConvex();
			const owner = await seedUser(t);
			const intentId = await seedIntent(t, owner.clerkUserId, {
				polar_checkout_url: "https://polar.test/checkout_1"
			});

			await handleClosedCheckout(routeCtx(t), {
				id: "checkout_1",
				status
			} as unknown as Parameters<typeof handleClosedCheckout>[1]);

			const intent = await t.run(async (ctx) => await ctx.db.get(intentId));
			expect(intent).toMatchObject({
				release_reason: reason,
				status: intentStatus
			});
			// The live checkout link is a capability anyone holding it could act on,
			// and it means nothing once the reservation is gone.
			expect(intent?.polar_checkout_url).toBeUndefined();
		}
	);

	// `checkout.updated` fires on every change, and most of them are a customer
	// still filling the form in.
	test.each(["open", "confirmed", "succeeded"])(
		"holds the reservation while a checkout is %s",
		async (status) => {
			const t = testConvex();
			const owner = await seedUser(t);
			const intentId = await seedIntent(t, owner.clerkUserId);

			await handleClosedCheckout(routeCtx(t), {
				id: "checkout_1",
				status
			} as unknown as Parameters<typeof handleClosedCheckout>[1]);

			expect(
				await t.run(async (ctx) => await ctx.db.get(intentId))
			).toMatchObject({ status: "active" });
		}
	);
});
