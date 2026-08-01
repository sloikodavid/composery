import { describe, expect, test } from "vitest";

import {
	compareEntries,
	entryLabel,
	GIT_FILE_ARGS,
	linkTarget,
	MODES
} from "../../scripts/tree.mjs";

describe("tree path discovery", () => {
	test("includes unstaged new files but not ignored scratch", () => {
		expect(GIT_FILE_ARGS).toEqual([
			"ls-files",
			"--cached",
			"--others",
			"--exclude-standard",
			"--stage",
			"-z"
		]);
	});
});

// The listing goes into every agent's context as the map of the repository, so
// a path that is not what it looks like has to say so on its own line. Without
// the mode every one of these renders as an ordinary file: an agent edits
// `CLAUDE.md` rather than the `AGENTS.md` it points at, or a submodule's
// contents rather than a patch.
describe("tree entry labels", () => {
	test("names what a symlink points at", () => {
		expect(
			entryLabel({
				mode: MODES.symlink,
				name: "CLAUDE.md",
				target: "AGENTS.md",
				type: "file"
			})
		).toBe("CLAUDE.md -> AGENTS.md");
	});

	test("marks a submodule as a directory this repository does not own", () => {
		expect(
			entryLabel({ mode: MODES.submodule, name: "upstream", type: "directory" })
		).toBe("upstream/ (submodule)");
	});

	test("marks an executable file", () => {
		expect(
			entryLabel({ mode: MODES.executable, name: "run.sh", type: "file" })
		).toBe("run.sh*");
	});

	test("leaves an ordinary file and directory as they were", () => {
		expect(
			entryLabel({ mode: MODES.file, name: "index.ts", type: "file" })
		).toBe("index.ts");
		expect(
			entryLabel({ mode: MODES.file, name: "scripts", type: "directory" })
		).toBe("scripts/");
	});
});

// The target is stored relative to the link, and the tree is rooted, so a
// target reprinted verbatim points somewhere the reader has to work out - and
// one that leaves the repository points at whatever the checkout sits next to,
// which is a fact about a machine rather than about this repository.
describe("tree symlink targets", () => {
	const paths = new Set([
		"AGENTS.md",
		"packages/web/AGENTS.md",
		".agents/skills/nugget/SKILL.md"
	]);

	test("resolves the target against the tree's root", () => {
		expect(linkTarget("packages/web/CLAUDE.md", "AGENTS.md", paths)).toBe(
			"packages/web/AGENTS.md"
		);
	});

	test("marks a target that holds other paths as a directory", () => {
		expect(linkTarget(".claude/skills", "../.agents/skills", paths)).toBe(
			".agents/skills/"
		);
	});

	test("names a target outside the repository rather than printing it", () => {
		expect(linkTarget(".claude/skills", "../../elsewhere", paths)).toBe(
			"(outside this repository)"
		);
	});

	// Nothing in the index means nothing to point at, whichever side of the root
	// it fell on - a dangling link is not describable either.
	test("names a target the index does not hold", () => {
		expect(linkTarget("CLAUDE.md", "GONE.md", paths)).toBe(
			"(outside this repository)"
		);
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
