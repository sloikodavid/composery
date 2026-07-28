import { describe, expect, test } from "vitest";
import { ownerCanReadBox } from "@/convex/boxes/access";

describe("ownerCanReadBox", () => {
	test("allows the owner to read a live box", () => {
		expect(
			ownerCanReadBox({ status: "running", user_id: "user-1" }, "user-1")
		).toBe(true);
	});

	test("hides deleted boxes even from their former owner", () => {
		expect(
			ownerCanReadBox({ status: "deleted", user_id: "user-1" }, "user-1")
		).toBe(false);
	});

	test("never exposes another user's box", () => {
		expect(
			ownerCanReadBox({ status: "running", user_id: "user-2" }, "user-1")
		).toBe(false);
	});
});
