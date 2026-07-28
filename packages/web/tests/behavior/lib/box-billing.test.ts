import { describe, expect, test } from "vitest";
import {
	annualSavingsPercent,
	formatPrice,
	isBoxBillingInterval,
	monthlyPriceFromMinorUnits
} from "@/lib/box-billing";

// Figures here are arbitrary, never the live Polar prices: the point is the
// arithmetic, and a fixture that copies the catalogue goes stale the first time
// someone reprices a product.
describe("box billing", () => {
	test("reads a monthly product's amount as the monthly price", () => {
		expect(monthlyPriceFromMinorUnits("month", 5000)).toBe(50);
	});

	test("spreads an annual product's amount over its twelve months", () => {
		expect(monthlyPriceFromMinorUnits("year", 120_000)).toBe(100);
	});

	test("states the saving the two prices actually describe", () => {
		const currency = "usd";
		expect(annualSavingsPercent({ currency, month: 100, year: 75 })).toBe(25);
		expect(annualSavingsPercent({ currency, month: 80, year: 40 })).toBe(50);
	});

	test("advertises no saving when the annual price stops being a discount", () => {
		const currency = "usd";
		expect(
			annualSavingsPercent({ currency, month: 100, year: 100 })
		).toBeNull();
		expect(
			annualSavingsPercent({ currency, month: 100, year: 125 })
		).toBeNull();
	});

	test("advertises a saving too small to round up as none at all", () => {
		const currency = "usd";
		expect(
			annualSavingsPercent({ currency, month: 100, year: 99.8 })
		).toBeNull();
	});

	test("claims no saving against a price it never read", () => {
		const currency = "usd";
		expect(
			annualSavingsPercent({ currency, month: null, year: 75 })
		).toBeNull();
		expect(
			annualSavingsPercent({ currency, month: 100, year: null })
		).toBeNull();
	});

	test("shows minor units only when the amount has them", () => {
		expect(formatPrice(50, "usd")).toBe("$50");
		expect(formatPrice(49.99, "usd")).toBe("$49.99");
	});

	test("renders the currency the Polar product is priced in", () => {
		expect(formatPrice(50, "eur")).toContain("€");
		expect(formatPrice(50, "usd")).not.toContain("€");
	});

	test("formats no price at all when Polar has not been read", () => {
		expect(formatPrice(null, "usd")).toBeNull();
		expect(formatPrice(50, null)).toBeNull();
	});

	test("accepts only supported Polar billing intervals", () => {
		expect(isBoxBillingInterval("month")).toBe(true);
		expect(isBoxBillingInterval("year")).toBe(true);
		expect(isBoxBillingInterval("annual")).toBe(false);
		expect(isBoxBillingInterval("constructor")).toBe(false);
	});
});
