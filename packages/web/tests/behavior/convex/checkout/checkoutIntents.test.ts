import { describe, expect, test } from "vitest";
import {
	paidOrderRecordingStatus,
	reservationsToRelease
} from "@/convex/checkout/checkoutIntents";

const paidOrder = {
	checkoutId: "checkout-new",
	orderId: "order-new",
	subscriptionId: "subscription-new"
};

describe("reservationsToRelease", () => {
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
		expect(() => reservationsToRelease(51, 3)).toThrow(/out of bounds/);
		expect(() => reservationsToRelease(3, 0)).toThrow(/out of bounds/);
		expect(() => reservationsToRelease(3, 51)).toThrow(/out of bounds/);
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
