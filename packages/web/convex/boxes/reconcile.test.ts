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

	// Parking volumes reuse this rule with `referenced = a live box still points
	// at it`. A succeeded rebuild clears the pointer and a deleted box drops it,
	// so those volumes become reclaimable orphans; a `rebuild_failed` box keeps
	// its pointer (referenced === true), which is what protects its files from
	// being reclaimed before the owner retries.
	it("reclaims an orphaned parking volume but never one a box still holds", () => {
		// Orphan: aged, no box points at it -> reclaimed.
		expect(isReclaimable(old, now, false)).toBe(true);
		// A rebuild_failed box still references its parking volume -> kept.
		expect(isReclaimable(old, now, true)).toBe(false);
	});
});
