import { describe, expect, it } from "vitest";
import {
	normalizeInternalReturnPath,
	parseAuthorizedParties,
	signInUrlForReturnPath
} from "@/lib/auth-routing";

describe("parseAuthorizedParties", () => {
	it("trims and filters configured origins", () => {
		expect(
			parseAuthorizedParties(
				" http://localhost:3000, , https://www.composery.io "
			)
		).toEqual(["http://localhost:3000", "https://www.composery.io"]);
	});

	it("returns an empty list when the value is missing", () => {
		expect(parseAuthorizedParties(undefined)).toEqual([]);
		expect(parseAuthorizedParties("")).toEqual([]);
	});

	it("normalizes origins by stripping the trailing slash", () => {
		expect(parseAuthorizedParties("https://www.composery.io/")).toEqual([
			"https://www.composery.io"
		]);
	});

	it("rejects paths, queries, and hashes on origins", () => {
		expect(() =>
			parseAuthorizedParties("https://www.composery.io/path")
		).toThrow("origins only");
		expect(() =>
			parseAuthorizedParties("https://www.composery.io?q=1")
		).toThrow("origins only");
		expect(() => parseAuthorizedParties("https://www.composery.io#x")).toThrow(
			"origins only"
		);
	});

	it("rejects non-http(s) schemes", () => {
		expect(() => parseAuthorizedParties("ftp://composery.io")).toThrow(
			"http(s)"
		);
		expect(() => parseAuthorizedParties("javascript:alert(1)")).toThrow();
	});

	it("rejects malformed origins", () => {
		expect(() => parseAuthorizedParties("not-a-url")).toThrow();
	});
});

describe("normalizeInternalReturnPath", () => {
	it("keeps internal paths with search params and hashes", () => {
		expect(normalizeInternalReturnPath("/boxes/new?from=pricing#slug")).toBe(
			"/boxes/new?from=pricing#slug"
		);
	});

	it("preserves query-only and hash-only internal paths", () => {
		expect(normalizeInternalReturnPath("/?q=1")).toBe("/?q=1");
		expect(normalizeInternalReturnPath("/boxes#x")).toBe("/boxes#x");
	});

	it("falls back to root for external or protocol-relative paths", () => {
		expect(normalizeInternalReturnPath("https://evil.test/boxes")).toBe("/");
		expect(normalizeInternalReturnPath("//evil.test/boxes")).toBe("/");
		expect(normalizeInternalReturnPath("boxes/new")).toBe("/");
	});

	it("falls back to root for backslash-based protocol evasion", () => {
		expect(normalizeInternalReturnPath("/\\evil.test/boxes")).toBe("/");
	});

	it("rejects data and javascript URIs", () => {
		expect(normalizeInternalReturnPath("data:text/html,x")).toBe("/");
	});

	it("always returns a path starting with a single slash", () => {
		for (const input of ["/boxes", "/a/b?c=1#d", "//x", "bad", ""]) {
			const result = normalizeInternalReturnPath(input);
			expect(result.startsWith("/")).toBe(true);
			expect(result.startsWith("//")).toBe(false);
		}
	});
});

describe("signInUrlForReturnPath", () => {
	it("preserves the redirect query contract", () => {
		expect(signInUrlForReturnPath("/boxes/new")).toBe(
			"/sign-in?redirect_url=%2Fboxes%2Fnew"
		);
	});

	it("url-encodes the query string and separators in the return path", () => {
		expect(signInUrlForReturnPath("/boxes/new?a=b&c=d")).toBe(
			"/sign-in?redirect_url=%2Fboxes%2Fnew%3Fa%3Db%26c%3Dd"
		);
	});

	it("neutralizes an external return path into the root", () => {
		expect(signInUrlForReturnPath("//evil.test/x")).toBe(
			"/sign-in?redirect_url=%2F"
		);
	});
});
