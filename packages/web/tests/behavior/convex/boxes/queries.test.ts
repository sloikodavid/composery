import { describe, expect, test } from "vitest";
import { hasCurrentSuspension } from "@/convex/boxes/queries";

describe("hasCurrentSuspension", () => {
	test("shows a reason only while suspension is current", () => {
		expect(hasCurrentSuspension("suspending")).toBe(true);
		expect(hasCurrentSuspension("suspended")).toBe(true);
		expect(hasCurrentSuspension("unsuspending")).toBe(false);
		expect(hasCurrentSuspension("running")).toBe(false);
		expect(hasCurrentSuspension("deleted")).toBe(false);
	});
});
