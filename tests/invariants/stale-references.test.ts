import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { normalize, posix, resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { readRepoFile, repoRoot } from "../support/repo.ts";

// ---------------------------------------------------------------------------
// A path named in prose is a claim, and it is the one kind of claim in this
// repository that nothing checks. Imports are resolved by the compiler and
// links between Markdown pages by docs-links.test.ts, but a path inside a
// comment, a doc sentence or a YAML header is read by a person, months later,
// who has no way to know it moved.
//
// They rot silently and they rot in the worst direction: a comment saying "the
// swap itself is driven in tests/favicon.test.ts" reads as proof that the swap
// is tested. There is no such file and never was. `docs/developing/ide.md`
// attributed the startup-page gate to an overlay module that does not exist,
// when the gate is installed by a patch. Four more pointed at test files that
// had moved under `tests/invariants/` when the three-kind layout landed.
//
// Duplication, and why it cannot be removed: the alternative to naming a file
// in prose is not naming it, which costs the reader the pointer. So the second
// copy stays and this walks it - the last rung of the ladder in AGENTS.md.
// ---------------------------------------------------------------------------

const tracked = execFileSync("git", ["ls-files"], {
	cwd: repoRoot,
	encoding: "utf8",
	maxBuffer: 64 * 1024 * 1024
})
	.split("\n")
	.filter(Boolean);

// Anything shaped like a path into this repository: at least one slash, and a
// first segment that is a real top-level directory here. That last condition is
// what keeps `node:fs`, `@clerk/nextjs` and `caddy:2.11.4-alpine` out.
const ROOTS = new Set([
	".github",
	"docs",
	"packages",
	"rootfs",
	"scripts",
	"templates",
	"tests"
]);

// `packages/web/` and the pages documenting it write their own paths the way
// that package's files do - `convex/schema.ts`, not
// `packages/web/convex/schema.ts` - so those roots are read there and only
// there. Everywhere else a bare `lib/…` means something different or nothing at
// all, and a file at the repository root has no package to resolve against.
//
// Reading them was what surfaced `convex/roles.ts` and `convex/authorization.ts`
// - two files long since folded into `convex/users.ts` - from behind a pile of
// package-relative paths that were all correct.
const WEB = /^(packages\/web|docs\/developing\/web)\//;
const WEB_ROOTS = new Set(["app", "components", "convex", "hooks", "lib"]);
const WEB_BASE = "packages/web/";

// `packages/ide/` speaks in the layout of the tree its build assembles, where
// `lib/vscode/…` and `src/…` are code-server's own directories rather than
// anything in this checkout. That vocabulary is the subject of the whole
// package, so those paths are not read here at all.
const IDE = /^packages\/ide\//;
const CANDIDATE =
	/(?<![\w./-])((?:[\w.-]+\/){1,6}[\w.-]+\.[a-z]{1,5})(?![\w/])/g;

const SEARCHED = /\.(ts|tsx|mjs|mts|rs|sh|md|mdx|yaml|json)$/;

// Paths that are correct without being in the checkout, each for a reason that
// is not "it moved". Nothing here may be a path this repository owns.
const NOT_IN_THE_CHECKOUT = new Set([
	// Written by cargo-mutants during the nightly run.
	"packages/cli/mutants.out",
	// Created by the operator from .env.example.next.dev; gitignored by design.
	"packages/web/.env.local",
	// A path on a running Composery, joined onto a temp directory by the
	// persistence crate's own tests. It names nothing in this checkout and never
	// will - `persistence` is a directory here as well, which is the only reason
	// the sweep looks at it at all.
	"persistence/config.json",
	// A module specifier handed to `require.resolve`, not a path: it resolves
	// through node_modules to whichever Convex the deployment installed. The
	// sweep sees a slash and a `.json` and cannot tell the two apart.
	"convex/package.json",
	// The body of `packages/web/package.json`'s `env:deploy` script, which runs
	// with that package as its working directory. Correct there, and nowhere
	// else - which is exactly what makes it look dangling from the root.
	"scripts/env.mjs"
]);

const files = tracked.filter(
	(file) =>
		SEARCHED.test(file) &&
		!file.startsWith("packages/ide/upstream") &&
		// Written by `convex dev`, and rewritten whole on the next run: nothing
		// here is a sentence anyone maintains.
		!file.includes("/_generated/") &&
		// This file, whose header quotes the dead paths it exists to catch -
		// `tests/favicon.test.ts` among them. A rule that documents its own
		// examples cannot also be held to them.
		file !== "tests/invariants/stale-references.test.ts"
);

const trackedSet = new Set(tracked);
const trackedDirs = new Set<string>();
for (const file of tracked) {
	let dir = posix.dirname(file);
	while (dir && dir !== ".") {
		trackedDirs.add(dir);
		dir = posix.dirname(dir);
	}
}

// A path in a comment is written relative to whatever root its author had in
// mind - the repository, the package, or the file's own directory. All three
// are legitimate, so a reference counts as live if it resolves against any of
// them, or against the submodule and node_modules that git does not track.
function resolves(path: string, from: string): boolean {
	return bases(from).some((base) => {
		const candidate = normalize(base + path)
			.split("\\")
			.join("/");
		if (trackedSet.has(candidate) || trackedDirs.has(candidate)) return true;
		try {
			// The upstream submodule and installed packages are real on disk and
			// invisible to `git ls-files`.
			return Boolean(statSync(resolve(repoRoot, candidate)));
		} catch {
			return false;
		}
	});
}

// Every directory a path could be written relative to: the repository root, the
// file's own directory and each of its ancestors, and - inside the web package -
// that package's root. The same list `resolves` walks, so "read" and "resolves"
// can never disagree about what a path was measured against.
function bases(file: string): string[] {
	const found = [""];
	let dir = posix.dirname(file);
	while (dir && dir !== ".") {
		found.push(`${dir}/`);
		dir = posix.dirname(dir);
	}
	if (WEB.test(file)) found.push(WEB_BASE);
	return found;
}

// Which roots a given file is allowed to name, which is the whole of what makes
// a bare `lib/openapi.ts` meaningful in one place and meaningless in another.
//
// The third clause is the one with a history. A comment in
// `convex/boxes/workflows/repairBox.ts` pointed at `workflows/changeBoxPlan.ts`,
// a file - and a feature - that has never existed, and this sweep did not read
// it: `workflows` is not a top-level root and not one of the web package's, so
// the path was discarded before anything tried to resolve it. Every directory
// name in the repository is a root somebody writes relative to, and enumerating
// them is the list that falls behind. So a first segment that names a real
// directory beside the file, or beside any of its ancestors, is read too - which
// is exactly the condition under which a reader would have followed it.
function reads(file: string, path: string): boolean {
	if (IDE.test(file)) return ROOTS.has(path.split("/")[0] ?? "");
	const root = path.split("/")[0] ?? "";
	if (ROOTS.has(root) || (WEB.test(file) && WEB_ROOTS.has(root))) return true;
	return bases(file).some((base) => trackedDirs.has(`${base}${root}`));
}

const dangling = files.flatMap((file) =>
	[...readRepoFile(file).matchAll(CANDIDATE)]
		.map((match) => match[1] ?? "")
		.filter((path) => reads(file, path))
		// An elision in prose ("overlay/.../narrow.css") names no single file.
		.filter((path) => !path.includes("..."))
		.filter((path) => !NOT_IN_THE_CHECKOUT.has(path))
		.filter((path) => !resolves(path, file))
		.map((path) => `${file}: ${path}`)
);

describe("every repository path named in prose exists", () => {
	test("the sweep reads the files it is meant to read", () => {
		// A green run has to mean the paths resolved, not that the regex stopped
		// finding any. Both numbers drop to zero the same way.
		expect(files.length).toBeGreaterThan(100);

		const found = files.flatMap((file) =>
			[...readRepoFile(file).matchAll(CANDIDATE)]
				.map((match) => match[1] ?? "")
				.filter((path) => reads(file, path))
		);
		expect(found.length).toBeGreaterThan(200);
	});

	test("no comment, doc or header points at a path that is not there", () => {
		expect([...new Set(dangling)].sort()).toEqual([]);
	});

	test("every exemption is still needed", () => {
		// An exemption for a path nobody writes any more is a rule with no
		// subject, and it silently re-permits that spelling later.
		const unused = [...NOT_IN_THE_CHECKOUT].filter(
			(path) =>
				!files.some((file) => readRepoFile(file).includes(path)) ||
				trackedSet.has(path)
		);

		expect(unused).toEqual([]);
	});
});
