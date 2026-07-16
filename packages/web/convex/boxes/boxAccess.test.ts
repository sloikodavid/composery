import { describe, expect, it } from "vitest";
import { ownerCanReadBox } from "./boxAccess";

describe("ownerCanReadBox", () => {
	it("allows the owner to read a live box", () => {
		expect(
			ownerCanReadBox({ status: "running", user_id: "user-1" }, "user-1")
		).toBe(true);
	});

	it("hides deleted boxes even from their former owner", () => {
		expect(
			ownerCanReadBox({ status: "deleted", user_id: "user-1" }, "user-1")
		).toBe(false);
	});

	it("never exposes another user's box", () => {
		expect(
			ownerCanReadBox({ status: "running", user_id: "user-2" }, "user-1")
		).toBe(false);
	});
});
