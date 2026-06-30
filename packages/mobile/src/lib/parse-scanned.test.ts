import { describe, expect, test } from "vitest";

import { parseScannedInstance } from "./parse-scanned";

describe("parseScannedInstance", () => {
	test("normalizes a plain https instance URL", () => {
		expect(parseScannedInstance("https://my-box.composery.cloud/")).toBe(
			"https://my-box.composery.cloud/"
		);
	});

	test("prepends https:// to a bare host", () => {
		expect(parseScannedInstance("my-box.composery.cloud")).toBe(
			"https://my-box.composery.cloud/"
		);
	});

	test("extracts the url from a composery deep link", () => {
		const link =
			"composery://add-instance?url=" +
			encodeURIComponent("https://my-box.composery.cloud/?folder=/app");
		expect(parseScannedInstance(link)).toBe(
			"https://my-box.composery.cloud/?folder=/app"
		);
	});

	test("extracts the url from a path-style composery deep link", () => {
		const link =
			"composery:///add-instance?url=" +
			encodeURIComponent("https://my-box.composery.cloud/code/");
		expect(parseScannedInstance(link)).toBe(
			"https://my-box.composery.cloud/code/"
		);
	});

	test("extracts the url from a no-slashes composery deep link", () => {
		const link =
			"composery:add-instance?url=" +
			encodeURIComponent("https://my-box.composery.cloud/code/");
		expect(parseScannedInstance(link)).toBe(
			"https://my-box.composery.cloud/code/"
		);
	});

	test("returns null for other composery deep links", () => {
		expect(
			parseScannedInstance(
				"composery://settings?url=https%3A%2F%2Fmy-box.composery.cloud%2F"
			)
		).toBeNull();
	});

	test("returns null for nested add-instance deep-link paths", () => {
		expect(
			parseScannedInstance(
				"composery://add-instance/other?url=https%3A%2F%2Fmy-box.composery.cloud%2F"
			)
		).toBeNull();
	});

	test("returns null for a deep link without a url param", () => {
		expect(parseScannedInstance("composery://add-instance?foo=bar")).toBeNull();
	});

	test("returns null for a malformed composery deep link", () => {
		expect(parseScannedInstance("composery://%zz")).toBeNull();
	});

	test("returns null for non-URL junk", () => {
		expect(parseScannedInstance("just some text")).toBeNull();
	});

	test("returns null for an empty payload", () => {
		expect(parseScannedInstance("   ")).toBeNull();
	});
});
