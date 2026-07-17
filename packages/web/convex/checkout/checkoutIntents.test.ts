import { describe, expect, it } from "vitest";
import { paidOrderRecordingStatus } from "./checkoutIntents";

const paidOrder = {
	checkoutId: "checkout-new",
	orderId: "order-new",
	subscriptionId: "subscription-new"
};

describe("paidOrderRecordingStatus", () => {
	it("reports a missing checkout intent", () => {
		expect(paidOrderRecordingStatus(null, paidOrder)).toBe("missing");
	});

	it("accepts a matching unfulfilled checkout", () => {
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

	it("rejects checkout metadata pointing at a different checkout", () => {
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

	it("rejects a second paid identity on an existing intent", () => {
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

	it("allows an idempotent redelivery for an already fulfilled box", () => {
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
