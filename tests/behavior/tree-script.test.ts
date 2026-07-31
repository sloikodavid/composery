import { describe, expect, test } from "vitest";

import { compareEntries, GIT_FILE_ARGS } from "../../scripts/tree.mjs";

describe("tree path discovery", () => {
	test("includes unstaged new files but not ignored scratch", () => {
		expect(GIT_FILE_ARGS).toEqual([
			"ls-files",
			"--cached",
			"--others",
			"--exclude-standard",
			"-z"
		]);
	});
});

describe("tree entry ordering", () => {
	const dir = (name: string) => ({ name, type: "directory" as const });
	const file = (name: string) => ({ name, type: "file" as const });

	// "_components" vs "[id]" flips between en-US and en-US-POSIX collation. A
	// runtime-default locale (undefined) resolves to en-US locally but POSIX on a
	// LANG=C.UTF-8 CI runner, so the committed tree could never match on CI. The
	// pin must keep en-US order everywhere; this fails on CI if it regresses.
	test("sorts underscore before bracket regardless of environment locale", () => {
		expect(compareEntries(dir("_components"), dir("[id]"))).toBeLessThan(0);
	});

	test("directories sort before files", () => {
		expect(compareEntries(file("aaa.ts"), dir("zzz"))).toBeGreaterThan(0);
	});
});
