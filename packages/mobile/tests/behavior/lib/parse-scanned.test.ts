import { assert, property } from "fast-check";
import { describe, expect, test } from "vitest";

import { normalizeInstanceUrl } from "@/lib/normalize-url";
import { parseScannedInstance } from "@/lib/parse-scanned";
import { instanceUrlArbitrary } from "../../support/urls";

describe("parseScannedInstance", () => {
	test("round-trips direct and deep-link payloads through normalization", () => {
		assert(
			property(instanceUrlArbitrary, (input) => {
				const normalized = normalizeInstanceUrl(input).href;
				const deepLink = `composery://add-instance?url=${encodeURIComponent(input)}`;

				expect(parseScannedInstance(input)).toBe(normalized);
				expect(parseScannedInstance(deepLink)).toBe(normalized);
			})
		);
	});

	test("normalizes a plain https instance URL", () => {
		expect(parseScannedInstance("https://my-box.composery.cloud/")).toBe(
			"https://my-box.composery.cloud/ide/"
		);
	});

	test("prepends https:// to a bare host", () => {
		expect(parseScannedInstance("my-box.composery.cloud")).toBe(
			"https://my-box.composery.cloud/ide/"
		);
	});

	test("extracts the url from a composery deep link", () => {
		const link =
			"composery://add-instance?url=" +
			encodeURIComponent("https://my-box.composery.cloud/?folder=/app");
		expect(parseScannedInstance(link)).toBe(
			"https://my-box.composery.cloud/ide/?folder=/app"
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

	test("accepts only the exact hostless add-instance path", () => {
		const encoded = encodeURIComponent("https://my-box.example/");
		expect(
			parseScannedInstance(`composery://///add-instance?url=${encoded}`)
		).toBe("https://my-box.example/ide/");
		expect(
			parseScannedInstance(`composery:not-add-instance?url=${encoded}`)
		).toBeNull();
	});

	test("accepts the hierarchical deep link with or without its root slash", () => {
		const encoded = encodeURIComponent("https://my-box.example/");
		expect(
			parseScannedInstance(`composery://add-instance?url=${encoded}`)
		).toBe("https://my-box.example/ide/");
		expect(
			parseScannedInstance(`composery://add-instance/?url=${encoded}`)
		).toBe("https://my-box.example/ide/");
	});

	test("returns null for non-URL junk", () => {
		expect(parseScannedInstance("just some text")).toBeNull();
	});

	test("returns null for an empty payload", () => {
		expect(parseScannedInstance("   ")).toBeNull();
	});
});
