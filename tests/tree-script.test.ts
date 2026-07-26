import { describe, expect, test } from "vitest";

import { compareEntries, GIT_FILE_ARGS, gitFiles } from "../scripts/tree.mjs";

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

	// The generated block is committed and checked on three OSes, so it may not
	// depend on the filesystem that produced it. It did: paths were re-resolved
	// against the real directory and took its spelling, so a committed case-only
	// rename kept its pre-rename name on Windows and macOS and no case-sensitive
	// checkout could ever agree. Names come from the index, exactly as stored.
	//
	// The fixture is a path whose *directory* segment is upper-case, because
	// re-resolving a directory is the failure this guards. It deliberately names
	// a path the repository cannot rename away from - an earlier version pinned a
	// file under `prompts/` that was later moved, which left the test asserting
	// the presence of a file no longer in the index.
	test("reports the index's spelling, not the working tree's", () => {
		const files = gitFiles();

		expect(files).toContain(".github/ISSUE_TEMPLATE/bug.yml");
		expect(files).not.toContain(".github/issue_template/bug.yml");
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
