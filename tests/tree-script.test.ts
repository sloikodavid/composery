import { describe, expect, test } from "vitest";

import { canonicalPaths } from "../scripts/tree.mjs";

function directories(contents: Record<string, string[]>) {
	return (path: string) => {
		const key = path.replaceAll("\\", "/");
		const entries = contents[key];
		if (!entries) throw Object.assign(new Error("missing"), { code: "ENOENT" });
		return entries;
	};
}

describe("tree path discovery", () => {
	test("deduplicates the two Git entries from a case-only file rename", () => {
		const readDirectory = directories({
			"/repo": ["prompts"],
			"/repo/prompts": ["senior-buzzwords.md"]
		});

		expect(
			canonicalPaths(
				"/repo",
				["prompts/BUZZWORDS.md", "prompts/senior-buzzwords.md"],
				readDirectory
			)
		).toEqual(["prompts/senior-buzzwords.md"]);
	});

	test("uses real casing for renamed directories and files", () => {
		const readDirectory = directories({
			"/repo": ["Docs"],
			"/repo/Docs": ["API.md"]
		});

		expect(canonicalPaths("/repo", ["docs/api.md"], readDirectory)).toEqual([
			"Docs/API.md"
		]);
	});

	test("preserves distinct case-sensitive siblings", () => {
		const readDirectory = directories({ "/repo": ["README.md", "readme.md"] });

		expect(
			canonicalPaths("/repo", ["README.md", "readme.md"], readDirectory)
		).toEqual(["README.md", "readme.md"]);
	});

	test("drops deleted paths and ambiguous case-insensitive matches", () => {
		const readDirectory = directories({
			"/repo": ["Foo", "foo", "present.md"]
		});

		expect(
			canonicalPaths(
				"/repo",
				["missing.md", "FOO", "present.md"],
				readDirectory
			)
		).toEqual(["present.md"]);
	});
});
