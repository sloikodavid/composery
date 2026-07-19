import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { setInterval } from "node:timers";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AGENTS_FILE = "AGENTS.md";
const TREE_START = "<!-- repo-structure:start -->";
const TREE_FINISH = "<!-- repo-structure:finish -->";
const write = process.argv.includes("--write");
const watch = process.argv.includes("--watch");

function caseKey(value) {
	return value.normalize("NFC").toLowerCase();
}

export function canonicalPath(root, path, readDirectory = readdirSync) {
	const canonical = [];

	for (const part of path.split("/").filter(Boolean)) {
		let entries;
		try {
			entries = readDirectory(join(root, ...canonical));
		} catch (error) {
			if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return;
			throw error;
		}

		const exact = entries.find((entry) => entry === part);
		const matches = exact
			? [exact]
			: entries.filter((entry) => caseKey(entry) === caseKey(part));
		if (matches.length !== 1) return;
		canonical.push(matches[0]);
	}

	return canonical.join("/");
}

export function canonicalPaths(root, paths, readDirectory = readdirSync) {
	return [
		...new Set(
			paths
				.map((path) => canonicalPath(root, path, readDirectory))
				.filter(Boolean)
		)
	];
}

function gitFiles() {
	const output = execFileSync(
		"git",
		["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
		{ cwd: REPO_ROOT }
	);
	return canonicalPaths(
		REPO_ROOT,
		output.toString("utf8").split("\0").filter(Boolean)
	);
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
		const entries = [...node.children.values()].sort((left, right) => {
			if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
			return left.name.localeCompare(right.name, undefined, {
				sensitivity: "base"
			});
		});

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
		"> Live-updated by `scripts/tree.mjs` when `pnpm dev` is running. Manually update with `pnpm fix:tree`.",
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
			console.error(
				`${AGENTS_FILE} tree block is out of date. Run 'pnpm fix:tree'.`
			);
			process.exitCode = 1;
		}
	}
}
