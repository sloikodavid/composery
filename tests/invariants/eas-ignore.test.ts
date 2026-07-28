// The paths EAS must not upload. `.easignore` is read by EAS's own uploader, so
// the list has to exist as that file - there is no way to hand the service a
// computed set - and the entries that matter are the mutable generated trees
// whose contents change while the archive is being built. Leaving one out does
// not fail: the upload succeeds, races, and produces a build from a tree that
// never existed on disk. This is the copy that says which entries are load
// bearing.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const entries = new Set(
	readFileSync(new URL("../../.easignore", import.meta.url), "utf8")
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
