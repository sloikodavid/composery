import { describe, expect, test } from "vitest";
import { BOX_STATUSES } from "@/convex/schema";
import { SLUG_OCCUPYING_STATUSES } from "@/convex/boxes/slugAvailability";

describe("slug lifecycle", () => {
	// Pin the rule, not three examples of it. A slug that stops being reserved is
	// a slug someone else can claim while the box still answers on it, so a status
	// missing from this list fails towards the harmful answer - which is exactly
	// the case a spot-check of "deleting" and "delete_failed" would not notice.
	test("reserves a slug for every box state except deleted", () => {
		const expected = BOX_STATUSES.filter((status) => status !== "deleted");

		expect([...SLUG_OCCUPYING_STATUSES].sort()).toEqual(expected.sort());
		expect(SLUG_OCCUPYING_STATUSES).not.toContain("deleted");
	});
});
