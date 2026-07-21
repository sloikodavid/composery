import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const entries = new Set(
	readFileSync(new URL("../.easignore", import.meta.url), "utf8")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("#"))
);

describe("EAS archive boundary", () => {
	test("excludes mutable generated trees that make monorepo uploads race", () => {
		for (const path of [
			".git/",
			"node_modules/",
			"**/node_modules/",
			"**/.next/",
			"**/.source/",
			"packages/ide/upstream/",
			"packages/mobile/android/",
			"packages/mobile/ios/"
		]) {
			expect(entries.has(path), `missing exact .easignore entry: ${path}`).toBe(
				true
			);
		}
	});

	test("excludes local secrets and signing material", () => {
		for (const path of [
			".env",
			".env.*",
			"*.jks",
			"*.p8",
			"*.p12",
			"*.key",
			"*.mobileprovision",
			"*.pem"
		]) {
			expect(entries.has(path), `missing exact .easignore entry: ${path}`).toBe(
				true
			);
		}
	});
});
