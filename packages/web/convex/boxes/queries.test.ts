import { describe, expect, it } from "vitest";
import { hasCurrentSuspension } from "./queries";

describe("hasCurrentSuspension", () => {
	it("shows a reason only while suspension is current", () => {
		expect(hasCurrentSuspension("suspending")).toBe(true);
		expect(hasCurrentSuspension("suspended")).toBe(true);
		expect(hasCurrentSuspension("unsuspending")).toBe(false);
		expect(hasCurrentSuspension("running")).toBe(false);
		expect(hasCurrentSuspension("deleted")).toBe(false);
	});
});
