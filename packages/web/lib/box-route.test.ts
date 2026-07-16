import { describe, expect, it } from "vitest";
import { boxPath, consoleBoxPath } from "./box-route";

describe("box detail routes", () => {
	it("uses the immutable box id for the owner route", () => {
		expect(boxPath("box-id-123")).toBe("/boxes/box-id-123");
	});

	it("uses the same immutable identity under the staff namespace", () => {
		expect(consoleBoxPath("box-id-123")).toBe("/console/boxes/box-id-123");
	});
});
