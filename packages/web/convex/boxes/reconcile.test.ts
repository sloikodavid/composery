import { describe, expect, it } from "vitest";
import { RECONCILE_MIN_AGE_MS, isReclaimable } from "./reconcile";

describe("isReclaimable", () => {
	const now = 10_000_000_000;
	const old = now - RECONCILE_MIN_AGE_MS - 1;
	const fresh = now - 1;

	it("reclaims aged, unreferenced resources", () => {
		expect(isReclaimable(old, now, false)).toBe(true);
	});

	it("never reclaims referenced resources", () => {
		expect(isReclaimable(old, now, true)).toBe(false);
		expect(isReclaimable(fresh, now, true)).toBe(false);
	});

	it("spares unreferenced resources inside the grace window", () => {
		expect(isReclaimable(fresh, now, false)).toBe(false);
		expect(isReclaimable(now, now, false)).toBe(false);
	});
});
