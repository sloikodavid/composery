import { describe, expect, it } from "vitest";
import {
	BOX_ANNUAL_SAVINGS_PERCENT,
	BOX_BILLING,
	isBoxBillingInterval
} from "@/lib/box-billing";

describe("box billing", () => {
	it("shows the annual charge as a $20 monthly equivalent", () => {
		expect(BOX_BILLING.year.monthlyPrice).toBe(20);
		expect(BOX_BILLING.year.billedPrice).toBe(
			BOX_BILLING.year.monthlyPrice * 12
		);
		expect(BOX_ANNUAL_SAVINGS_PERCENT).toBe(17);
	});

	it("accepts only supported Polar billing intervals", () => {
		expect(isBoxBillingInterval("month")).toBe(true);
		expect(isBoxBillingInterval("year")).toBe(true);
		expect(isBoxBillingInterval("annual")).toBe(false);
	});
});
