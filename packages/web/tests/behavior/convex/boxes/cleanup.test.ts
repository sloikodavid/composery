import { describe, expect, test } from "vitest";
import {
	DELETE_ATTEMPTS_BEFORE_ALERT,
	deleteNeedsPerson
} from "@/convex/boxes/cleanup";
import { SUBSCRIPTION_RECONCILIATION_STATUSES } from "@/convex/boxes/queries";

describe("deleteNeedsPerson", () => {
	// The incident this sweep exists for had exactly one failed delete, on a box
	// whose Hetzner teardown had already finished. A rule that only reacted to
	// repeat failures would have stayed silent on it - which is what happened.
	test("does not call one failure a standing problem", () => {
		expect(deleteNeedsPerson(1)).toBe(false);
	});

	test("escalates at the threshold and not before", () => {
		expect(deleteNeedsPerson(DELETE_ATTEMPTS_BEFORE_ALERT - 1)).toBe(false);
		expect(deleteNeedsPerson(DELETE_ATTEMPTS_BEFORE_ALERT)).toBe(true);
		expect(deleteNeedsPerson(DELETE_ATTEMPTS_BEFORE_ALERT + 10)).toBe(true);
	});
});

describe("delete_failed has one owner", () => {
	// If subscription reconciliation started reaching delete_failed boxes again,
	// two hourly sweeps would re-drive the same deletion under different triggers
	// and the box's history would stop saying which one was finishing it.
	test("leaves delete_failed to the sweep that finishes deletions", () => {
		expect(SUBSCRIPTION_RECONCILIATION_STATUSES).not.toContain("delete_failed");
	});

	// The exclusion has to stay narrow: a box that is merely broken is not on its
	// way out, and its subscription still has to be checked.
	test("still reconciles boxes that failed something other than deletion", () => {
		expect(SUBSCRIPTION_RECONCILIATION_STATUSES).toContain("repair_failed");
		expect(SUBSCRIPTION_RECONCILIATION_STATUSES).toContain("create_failed");
		expect(SUBSCRIPTION_RECONCILIATION_STATUSES).toContain("running");
	});
});
