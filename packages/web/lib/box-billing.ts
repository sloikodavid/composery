export const BOX_BILLING = {
	month: {
		billedPrice: 24,
		label: "Monthly",
		monthlyPrice: 24
	},
	year: {
		billedPrice: 240,
		label: "Annual",
		monthlyPrice: 20
	}
} as const;

export const BOX_ANNUAL_SAVINGS_PERCENT = Math.round(
	(1 - BOX_BILLING.year.billedPrice / (BOX_BILLING.month.monthlyPrice * 12)) *
		100
);

export type BoxBillingInterval = keyof typeof BOX_BILLING;

export function isBoxBillingInterval(
	value: unknown
): value is BoxBillingInterval {
	return value === "month" || value === "year";
}
