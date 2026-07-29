import { execFileSync } from "node:child_process";

import { describe, expect, test } from "vitest";

import { readRepoFile, repoRoot } from "../support/repo.ts";

// Provider manifests have to repeat environment names because Fly, Kubernetes,
// Render, Railway, and Compose consume those files directly; none can derive its
// keys from Composery's Markdown configuration reference. Pin every exact name in
// either active config or a copyable commented example so a rename cannot leave a
// template accepting an environment variable the product no longer documents.

const templateFiles = execFileSync("git", ["ls-files", "templates"], {
	cwd: repoRoot,
	encoding: "utf8"
})
	.split("\n")
	.filter(Boolean);

describe("deployment templates", () => {
	test("documents every Composery environment variable they name", () => {
		const variables = new Set(
			templateFiles.flatMap((path) =>
				[
					...readRepoFile(path).matchAll(
						/(?<![A-Z0-9_])(COMPOSERY_[A-Z0-9_]+)(?![A-Z0-9_])/g
					)
				].flatMap((match) => match[1] ?? [])
			)
		);
		const documented = new Set(
			[
				...readRepoFile("docs/configuration.md").matchAll(
					/`(COMPOSERY_[A-Z0-9_]+)`/g
				)
			].flatMap((match) => match[1] ?? [])
		);

		expect(variables.size).toBeGreaterThan(0);
		expect(
			[...variables].filter((variable) => !documented.has(variable))
		).toEqual([]);
	});
});
