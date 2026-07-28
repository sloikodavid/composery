import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { errorMessage } from "@/lib/error-message";

describe("errorMessage", () => {
	test("extracts the string payload of a ConvexError", () => {
		expect(errorMessage(new ConvexError("nope"))).toBe("nope");
	});

	test("serializes a non-string ConvexError payload", () => {
		expect(errorMessage(new ConvexError({ kind: "user_suspended" }))).toBe(
			JSON.stringify({ kind: "user_suspended" })
		);
	});

	test("reads the message of a plain Error", () => {
		expect(errorMessage(new Error("boom"))).toBe("boom");
	});

	test("stringifies non-Error throwables", () => {
		expect(errorMessage("literal string")).toBe("literal string");
		expect(errorMessage(42)).toBe("42");
		expect(errorMessage(undefined)).toBe("undefined");
	});
});
