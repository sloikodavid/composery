import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TREE_OUTPUT_FILE = "prompts/TREE.md";
const write = process.argv.includes("--write");

function gitFiles() {
	const output = execFileSync(
		"git",
		["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
		{ cwd: REPO_ROOT }
	);
	return output
		.toString("utf8")
		.split("\0")
		.filter(Boolean)
		.filter(
			(path) => path !== TREE_OUTPUT_FILE && existsSync(join(REPO_ROOT, path))
		);
}

function renderTree() {
	const root = {
		children: new Map(),
		name: basename(REPO_ROOT),
		type: "directory"
	};

	for (const path of [...gitFiles(), TREE_OUTPUT_FILE]) {
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

		if (depth > 0 && entries.length > 40)
			return [`${"  ".repeat(depth)}... (${entries.length} items)`];

		return entries.flatMap((entry) => [
			`${"  ".repeat(depth)}${entry.name}${entry.type === "directory" ? "/" : ""}`,
			...(entry.type === "directory" ? renderNode(entry, depth + 1) : [])
		]);
	}

	return [
		"# Tree",
		"",
		"> Run `pnpm fix` to regenerate this file - do not edit manually.",
		"",
		"```text",
		...renderNode(root),
		"```",
		""
	].join("\n");
}

const file = join(REPO_ROOT, TREE_OUTPUT_FILE);
const expected = renderTree();
const actual = existsSync(file) ? readFileSync(file, "utf8") : "";

if (actual === expected) process.exit(0);
if (write) {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, expected);
	process.exit(0);
}

console.error(`${TREE_OUTPUT_FILE} is out of date. Run 'pnpm fix'.`);
process.exit(1);
