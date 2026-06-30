import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { errorMessage } from "@/lib/error-message";

describe("errorMessage", () => {
	it("extracts the string payload of a ConvexError", () => {
		expect(errorMessage(new ConvexError("nope"))).toBe("nope");
	});

	it("serializes a non-string ConvexError payload", () => {
		expect(errorMessage(new ConvexError({ kind: "user_suspended" }))).toBe(
			JSON.stringify({ kind: "user_suspended" })
		);
	});

	it("reads the message of a plain Error", () => {
		expect(errorMessage(new Error("boom"))).toBe("boom");
	});

	it("stringifies non-Error throwables", () => {
		expect(errorMessage("literal string")).toBe("literal string");
		expect(errorMessage(42)).toBe("42");
		expect(errorMessage(undefined)).toBe("undefined");
	});
});
