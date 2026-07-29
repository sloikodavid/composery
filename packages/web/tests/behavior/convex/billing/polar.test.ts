import { afterEach, describe, expect, test, vi } from "vitest";
import {
	boxProductIds,
	boxSellableForProductId,
	revokeAndRefundPolarOrder,
	selectPolarCheckoutProduct
} from "@/convex/billing/polar";

function stubBoxProducts() {
	vi.stubEnv("POLAR_BOX_AIR_MONTHLY_PRODUCT_ID", "air-monthly");
	vi.stubEnv("POLAR_BOX_AIR_ANNUAL_PRODUCT_ID", "air-annual");
	vi.stubEnv("POLAR_BOX_PRO_MONTHLY_PRODUCT_ID", "pro-monthly");
	vi.stubEnv("POLAR_BOX_PRO_ANNUAL_PRODUCT_ID", "pro-annual");
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("box products", () => {
	test("offers only the chosen plan's two intervals, selected one first", () => {
		stubBoxProducts();

		expect(boxProductIds({ billingInterval: "year", plan: "air" })).toEqual([
			"air-annual",
			"air-monthly"
		]);
		expect(boxProductIds({ billingInterval: "month", plan: "pro" })).toEqual([
			"pro-monthly",
			"pro-annual"
		]);
		// The other plan's products are absent, which is what stops a checkout
		// admitted as Air from being paid for as Pro.
		expect(
			boxProductIds({ billingInterval: "month", plan: "air" })
		).not.toContain("pro-monthly");
	});

	test("reads a product id back to the plan and interval it sells", () => {
		stubBoxProducts();

		expect(boxSellableForProductId("pro-annual")).toEqual({
			billingInterval: "year",
			plan: "pro"
		});
		expect(boxSellableForProductId("air-monthly")).toEqual({
			billingInterval: "month",
			plan: "air"
		});
		expect(boxSellableForProductId("another-product")).toBeNull();
		expect(boxSellableForProductId(null)).toBeNull();
	});

	// The sweep that reads this runs across every box, so an unconfigured product
	// must degrade to "not one of ours" rather than throw and abandon the pass.
	test("treats an unconfigured product id as not ours instead of throwing", () => {
		vi.stubEnv("POLAR_BOX_AIR_MONTHLY_PRODUCT_ID", "");
		vi.stubEnv("POLAR_BOX_AIR_ANNUAL_PRODUCT_ID", "");
		vi.stubEnv("POLAR_BOX_PRO_MONTHLY_PRODUCT_ID", "");
		vi.stubEnv("POLAR_BOX_PRO_ANNUAL_PRODUCT_ID", "");

		expect(boxSellableForProductId("air-monthly")).toBeNull();
	});

	test("updates a resumable checkout to the selected product", async () => {
		vi.stubEnv("POLAR_ENVIRONMENT", "sandbox");
		vi.stubEnv("POLAR_ORGANIZATION_TOKEN", "polar-token");
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", fetch);

		await selectPolarCheckoutProduct("checkout-id", "annual-product");

		expect(fetch).toHaveBeenCalledOnce();
		expect(fetch.mock.calls[0]?.[0]).toContain("/v1/checkouts/checkout-id");
		expect(fetch.mock.calls[0]?.[1]).toMatchObject({
			method: "PATCH",
			body: JSON.stringify({ product_id: "annual-product" })
		});
	});
});

describe("revokeAndRefundPolarOrder", () => {
	test("revokes first and refunds the order's full remaining amount", async () => {
		vi.stubEnv("POLAR_ENVIRONMENT", "sandbox");
		vi.stubEnv("POLAR_ORGANIZATION_TOKEN", "polar-token");
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(
				Response.json({ refundable_amount: 2500, refunded_amount: 0 })
			)
			.mockResolvedValueOnce(Response.json({ items: [] }))
			.mockResolvedValueOnce(Response.json({ status: "succeeded" }));
		vi.stubGlobal("fetch", fetch);

		await revokeAndRefundPolarOrder({
			comment: "Initial delivery failed.",
			idempotencyKey: "fulfillment-failure:box-id",
			orderId: "order-id",
			subscriptionId: "subscription-id"
		});

		expect(fetch).toHaveBeenCalledTimes(4);
		expect(fetch.mock.calls[0]?.[0]).toContain(
			"/v1/subscriptions/subscription-id"
		);
		expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
		expect(fetch.mock.calls[3]?.[0]).toContain("/v1/refunds/");
		expect(JSON.parse(String(fetch.mock.calls[3]?.[1]?.body))).toEqual({
			amount: 2500,
			comment: "Initial delivery failed.",
			metadata: {
				composery_refund_key: "fulfillment-failure:box-id"
			},
			order_id: "order-id",
			reason: "service_disruption"
		});
	});

	test("does not create another refund when nothing remains refundable", async () => {
		vi.stubEnv("POLAR_ENVIRONMENT", "sandbox");
		vi.stubEnv("POLAR_ORGANIZATION_TOKEN", "polar-token");
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(Response.json({ refundable_amount: 0 }));
		vi.stubGlobal("fetch", fetch);

		await revokeAndRefundPolarOrder({
			comment: "Already refunded.",
			idempotencyKey: "same-operation",
			orderId: "order-id",
			subscriptionId: "subscription-id"
		});

		expect(fetch).toHaveBeenCalledTimes(2);
	});

	test("waits for an existing idempotent refund instead of duplicating it", async () => {
		vi.stubEnv("POLAR_ENVIRONMENT", "sandbox");
		vi.stubEnv("POLAR_ORGANIZATION_TOKEN", "polar-token");
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(Response.json({ refundable_amount: 2500 }))
			.mockResolvedValueOnce(
				Response.json({
					items: [
						{
							metadata: { composery_refund_key: "same-operation" },
							status: "pending"
						}
					]
				})
			);
		vi.stubGlobal("fetch", fetch);

		await expect(
			revokeAndRefundPolarOrder({
				comment: "Still processing.",
				idempotencyKey: "same-operation",
				orderId: "order-id",
				subscriptionId: "subscription-id"
			})
		).rejects.toThrow("is pending");
		expect(fetch).toHaveBeenCalledTimes(3);
	});
});
