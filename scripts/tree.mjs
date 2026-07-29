import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { setInterval } from "node:timers";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AGENTS_FILE = "AGENTS.md";
const TREE_START = "<!-- tree:start -->";
const TREE_FINISH = "<!-- tree:finish -->";
const write = process.argv.includes("--write");
const watch = process.argv.includes("--watch");

// Include new, non-ignored files before they are staged. A tree check that is
// green before `git add` but turns red after it is not checking the artifact a
// contributor is about to commit.
export const GIT_FILE_ARGS = [
	"ls-files",
	"--cached",
	"--others",
	"--exclude-standard",
	"-z"
];

// Git's names, verbatim. This used to re-resolve every path against the real
// directory and take the filesystem's spelling, which made the generated file
// depend on the machine that ran it: a committed case-only rename
// (prompts/REFACTOR.md) still had the old name on disk under Windows' and
// macOS' case-insensitive lookup, so `pnpm fix:tree` wrote a name no
// case-sensitive checkout has and CI failed on every commit afterwards. The
// index is what gets pushed, so the index is the only authority here.
export function gitFiles() {
	return execFileSync("git", GIT_FILE_ARGS, { cwd: REPO_ROOT })
		.toString("utf8")
		.split("\0")
		.filter(Boolean);
}

// Directories before files, then by name under a pinned locale. localeCompare
// with a default (undefined) locale resolves it from the environment (en-US on
// the author's box, en-US-POSIX on a LANG=C.UTF-8 CI runner), which sorts
// "_components" vs "[id]" differently and makes the committed tree fail the CI
// check forever. Exported so a test guards the pin.
export function compareEntries(left, right) {
	if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
	return left.name.localeCompare(right.name, "en-US", { sensitivity: "base" });
}

function renderTree() {
	const root = {
		children: new Map(),
		name: basename(REPO_ROOT),
		type: "directory"
	};

	for (const path of [...gitFiles(), AGENTS_FILE]) {
		const parts = path.split("/").filter(Boolean);
		let current = root;
		for (const [index, name] of parts.entries()) {
			const type = index === parts.length - 1 ? "file" : "directory";
			let next = current.children.get(name);
			if (!next) {
				next = { children: new Map(), name, type };
				current.children.set(name, next);
			}
			current = next;
		}
	}

	function renderNode(node, depth = 0) {
		const entries = [...node.children.values()].sort(compareEntries);

		if (depth > 0 && entries.length > 80)
			return [`${"  ".repeat(depth)}... (${entries.length} items)`];

		return entries.flatMap((entry) => [
			`${"  ".repeat(depth)}${entry.name}${entry.type === "directory" ? "/" : ""}`,
			...(entry.type === "directory" ? renderNode(entry, depth + 1) : [])
		]);
	}

	return [
		TREE_START,
		"",
		"> Live-updated by `scripts/tree.mjs` when `pnpm dev` or `pnpm dev:tree` is running. Manually update with `pnpm fix:tree`.",
		"",
		"```text",
		...renderNode(root),
		"```",
		"",
		TREE_FINISH,
		""
	].join("\n");
}

function renderAgentsFile(current, tree) {
	const start = current.indexOf(TREE_START);
	const finish = current.indexOf(TREE_FINISH);

	if (start !== -1 && finish !== -1 && finish > start) {
		const before = current.slice(0, start).trimEnd();
		const after = current.slice(finish + TREE_FINISH.length).trimStart();
		return [before, tree.trimEnd(), after].filter(Boolean).join("\n\n") + "\n";
	}

	return `${current.trimEnd()}\n\n${tree}`;
}

function expectedAgentsFile() {
	const file = join(REPO_ROOT, AGENTS_FILE);
	const current = existsSync(file) ? readFileSync(file, "utf8") : "";
	return renderAgentsFile(current, renderTree());
}

function syncTree({ quiet = false } = {}) {
	const file = join(REPO_ROOT, AGENTS_FILE);
	const expected = expectedAgentsFile();
	const actual = existsSync(file) ? readFileSync(file, "utf8") : "";

	if (actual === expected) return false;

	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, expected);
	if (!quiet) console.log(`Updated ${AGENTS_FILE}`);
	return true;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	if (watch) {
		syncTree();
		setInterval(() => syncTree({ quiet: true }), 1000);
		process.stdin.resume();
	} else if (write) {
		syncTree();
	} else {
		const file = join(REPO_ROOT, AGENTS_FILE);
		const expected = expectedAgentsFile();
		const actual = existsSync(file) ? readFileSync(file, "utf8") : "";

		if (actual !== expected) {
			// Naming the drifting lines is the whole value of this check on a CI
			// runner: "out of date" alone cannot distinguish a forgotten fix:tree
			// from a file that only exists on that machine, and the runner is gone
			// by the time anyone reads it.
			const actualLines = new Set(actual.split("\n"));
			const expectedLines = new Set(expected.split("\n"));
			console.error(
				[
					`${AGENTS_FILE} tree block is out of date. Run 'pnpm fix:tree'.`,
					...expected
						.split("\n")
						.filter((line) => line.trim() && !actualLines.has(line))
						.map((line) => `+${line}`),
					...actual
						.split("\n")
						.filter((line) => line.trim() && !expectedLines.has(line))
						.map((line) => `-${line}`)
				].join("\n")
			);
			process.exitCode = 1;
		}
	}
}
