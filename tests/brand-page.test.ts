import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { readRepoFile } from "./support/patchSource.ts";

const repoRoot = resolve(import.meta.dirname, "..");

describe("brand surfaces", () => {
	test("the obsolete design showcase is not a route or navigation item", () => {
		expect(
			existsSync(resolve(repoRoot, "packages/web/app/(site)/design/page.tsx"))
		).toBe(false);
		expect(readRepoFile("packages/web/lib/nav-links.ts")).not.toContain(
			'"/design"'
		);
	});

	test("the public brand page has no second hard-coded palette", () => {
		const source = readRepoFile(
			"packages/web/app/(site)/brand/_components/brand-kit.tsx"
		);
		expect(source).toContain("BRAND_ASSETS");
		expect(source).not.toMatch(/#[0-9a-f]{3,8}/i);
	});
});
