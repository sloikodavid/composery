import { describe, expect, test } from "vitest";
import {
	isReservedSlug,
	isValidSlug,
	isValidSlugFormat,
	sanitizeSlug
} from "@/lib/box-slug";

describe("sanitizeSlug", () => {
	test("lowercases, strips invalid characters, and trims leading dashes", () => {
		expect(sanitizeSlug("--My Box!!")).toBe("mybox");
	});

	test("limits slugs to 63 characters", () => {
		expect(sanitizeSlug("a".repeat(70))).toHaveLength(63);
	});

	test("returns an empty string for input with no usable characters", () => {
		expect(sanitizeSlug("")).toBe("");
		expect(sanitizeSlug("---")).toBe("");
		expect(sanitizeSlug("   ")).toBe("");
		expect(sanitizeSlug("!!!")).toBe("");
	});

	test("removes every character outside the a-z0-9- set", () => {
		expect(sanitizeSlug("H3ll0_Wörld-2026")).toBe("h3ll0wrld-2026");
	});

	test("collapses nothing: trailing dashes are preserved by sanitize", () => {
		expect(sanitizeSlug("box-")).toBe("box-");
	});

	test("drops invalid characters but keeps the dashes around them", () => {
		expect(sanitizeSlug("café-Æ-🐍-box")).toBe("caf---box");
	});
});

describe("isValidSlug", () => {
	test("accepts DNS-safe box slugs", () => {
		expect(isValidSlug("my-box")).toBe(true);
		expect(isValidSlug("abc")).toBe(true);
		expect(isValidSlug("a-b-c")).toBe(true);
		expect(isValidSlug("box1")).toBe(true);
		expect(isValidSlug("123")).toBe(true);
	});

	test("rejects too-short slugs", () => {
		expect(isValidSlug("ab")).toBe(false);
		expect(isValidSlug("a")).toBe(false);
		expect(isValidSlug("")).toBe(false);
	});

	test("rejects leading and trailing dashes", () => {
		expect(isValidSlug("-box")).toBe(false);
		expect(isValidSlug("box-")).toBe(false);
		expect(isValidSlug("-box-")).toBe(false);
	});

	test("rejects punycode-prefixed slugs", () => {
		expect(isValidSlug("xn--box")).toBe(false);
	});

	test("rejects invalid characters and casing", () => {
		expect(isValidSlug("my_box")).toBe(false);
		expect(isValidSlug("My-Box")).toBe(false);
		expect(isValidSlug("my.box")).toBe(false);
		expect(isValidSlug("my box")).toBe(false);
	});

	test("accepts the maximum 63-character slug and rejects 64", () => {
		expect(isValidSlug("a".repeat(63))).toBe(true);
		expect(isValidSlug("a".repeat(64))).toBe(false);
	});

	test("allows consecutive interior dashes", () => {
		expect(isValidSlug("a--b")).toBe(true);
	});
});

describe("isValidSlugFormat", () => {
	test("separates well-formed reserved names from malformed slugs", () => {
		expect(isValidSlugFormat("console")).toBe(true);
		expect(isValidSlugFormat("my-box")).toBe(true);
		expect(isValidSlugFormat("ab")).toBe(false);
		expect(isValidSlugFormat("my-box-")).toBe(false);
	});
});

describe("reserved slugs", () => {
	test("blocks runtime subdomains from being claimed as box slugs", () => {
		for (const slug of ["console", "www", "api", "admin", "docs", "status"]) {
			expect(isReservedSlug(slug)).toBe(true);
			expect(isValidSlug(slug)).toBe(false);
		}
	});

	test("does not block ordinary box slugs", () => {
		expect(isReservedSlug("my-box")).toBe(false);
		expect(isReservedSlug("productionbox")).toBe(false);
	});

	test("reserved checks are case-sensitive (reservations are lowercase)", () => {
		expect(isReservedSlug("Console")).toBe(false);
		expect(isReservedSlug("CONSOLE")).toBe(false);
	});
});
