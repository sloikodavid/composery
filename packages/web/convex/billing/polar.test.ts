import { afterEach, describe, expect, it, vi } from "vitest";
import { revokeAndRefundPolarOrder } from "./polar";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("revokeAndRefundPolarOrder", () => {
	it("revokes first and refunds the order's full remaining amount", async () => {
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

	it("does not create another refund when nothing remains refundable", async () => {
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

	it("waits for an existing idempotent refund instead of duplicating it", async () => {
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
