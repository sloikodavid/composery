import { describe, expect, it } from "vitest";
import { SLUG_OCCUPYING_STATUSES } from "./slugAvailability";

describe("slug lifecycle", () => {
	it("reserves a slug for every box state except deleted", () => {
		expect(SLUG_OCCUPYING_STATUSES).not.toContain("deleted");
		expect(SLUG_OCCUPYING_STATUSES).toContain("deleting");
		expect(SLUG_OCCUPYING_STATUSES).toContain("delete_failed");
	});
});
