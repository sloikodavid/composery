import { describe, expect, it } from "vitest";
import { isReservedSlug, isValidSlug, sanitizeSlug } from "@/lib/box-slug";

describe("sanitizeSlug", () => {
	it("lowercases, strips invalid characters, and trims leading dashes", () => {
		expect(sanitizeSlug("--My Box!!")).toBe("mybox");
	});

	it("limits slugs to 63 characters", () => {
		expect(sanitizeSlug("a".repeat(70))).toHaveLength(63);
	});

	it("returns an empty string for input with no usable characters", () => {
		expect(sanitizeSlug("")).toBe("");
		expect(sanitizeSlug("---")).toBe("");
		expect(sanitizeSlug("   ")).toBe("");
		expect(sanitizeSlug("!!!")).toBe("");
	});

	it("removes every character outside the a-z0-9- set", () => {
		expect(sanitizeSlug("H3ll0_Wörld-2026")).toBe("h3ll0wrld-2026");
	});

	it("collapses nothing: trailing dashes are preserved by sanitize", () => {
		expect(sanitizeSlug("box-")).toBe("box-");
	});

	it("drops invalid characters but keeps the dashes around them", () => {
		expect(sanitizeSlug("café-Æ-🐍-box")).toBe("caf---box");
	});
});

describe("isValidSlug", () => {
	it("accepts DNS-safe box slugs", () => {
		expect(isValidSlug("my-box")).toBe(true);
		expect(isValidSlug("abc")).toBe(true);
		expect(isValidSlug("a-b-c")).toBe(true);
		expect(isValidSlug("box1")).toBe(true);
		expect(isValidSlug("123")).toBe(true);
	});

	it("rejects too-short slugs", () => {
		expect(isValidSlug("ab")).toBe(false);
		expect(isValidSlug("a")).toBe(false);
		expect(isValidSlug("")).toBe(false);
	});

	it("rejects leading and trailing dashes", () => {
		expect(isValidSlug("-box")).toBe(false);
		expect(isValidSlug("box-")).toBe(false);
		expect(isValidSlug("-box-")).toBe(false);
	});

	it("rejects punycode-prefixed slugs", () => {
		expect(isValidSlug("xn--box")).toBe(false);
	});

	it("rejects invalid characters and casing", () => {
		expect(isValidSlug("my_box")).toBe(false);
		expect(isValidSlug("My-Box")).toBe(false);
		expect(isValidSlug("my.box")).toBe(false);
		expect(isValidSlug("my box")).toBe(false);
	});

	it("accepts the maximum 63-character slug and rejects 64", () => {
		expect(isValidSlug("a".repeat(63))).toBe(true);
		expect(isValidSlug("a".repeat(64))).toBe(false);
	});

	it("allows consecutive interior dashes", () => {
		expect(isValidSlug("a--b")).toBe(true);
	});
});

describe("reserved slugs", () => {
	it("blocks runtime subdomains from being claimed as box slugs", () => {
		for (const slug of ["console", "www", "api", "admin", "docs", "status"]) {
			expect(isReservedSlug(slug)).toBe(true);
			expect(isValidSlug(slug)).toBe(false);
		}
	});

	it("does not block ordinary box slugs", () => {
		expect(isReservedSlug("my-box")).toBe(false);
		expect(isReservedSlug("productionbox")).toBe(false);
	});

	it("reserved checks are case-sensitive (reservations are lowercase)", () => {
		expect(isReservedSlug("Console")).toBe(false);
		expect(isReservedSlug("CONSOLE")).toBe(false);
	});
});
