import { execFileSync, spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");

function run(command, args, options = {}) {
	console.log(`\n$ ${[command, ...args].join(" ")}`);
	const result = spawnSync(command, args, {
		cwd: REPO_ROOT,
		stdio: "inherit",
		...options
	});
	if (result.error) {
		console.error(result.error.message);
		process.exit(1);
	}
	if (result.status !== 0) process.exit(result.status ?? 1);
}

// Typecheck the IDE server tree exactly as build.sh assembles it: pristine
// upstream src + every code-server-side patch + overlay's new files. Sources
// come from git blobs (always LF) so the patches apply on Windows working
// trees too.
const UPSTREAM = join(PACKAGE_ROOT, "upstream");
const OVERLAY = join(PACKAGE_ROOT, "overlay");
// Code-server-side patches in series order. "src" entries also span
// lib/vscode; only their src/ sections apply here, because lib/vscode is not
// part of this tree. Order matters: later patches' contexts build on earlier
// ones (readiness anchors on routes auth adds).
const SERVER_PATCHES = [
	["naming.diff", "full"],
	["hardening.diff", "full"],
	["auth.diff", "src"],
	["readiness.diff", "full"],
	["node-engine.diff", "full"],
	["api.diff", "src"],
	["updates.diff", "src"]
];
const SCRATCH = join(
	REPO_ROOT,
	"tmp",
	`ide-overlay-typecheck-${Date.now()}-${process.pid}`
);
// A failed npm install/typecheck must not leave a full upstream tree and its
// node_modules behind. The exit hook also covers run()'s deliberate exits.
process.on("exit", () => rmSync(SCRATCH, { force: true, recursive: true }));
const isWindows = process.platform === "win32";
const NPM_CLI = join(
	dirname(process.execPath),
	"node_modules/npm/bin/npm-cli.js"
);

if (!existsSync(join(UPSTREAM, "package.json"))) {
	console.error(
		"packages/ide/upstream is empty; run pnpm setup to init submodules."
	);
	process.exit(1);
}

rmSync(SCRATCH, { force: true, recursive: true });
mkdirSync(SCRATCH, { recursive: true });

// SCRATCH sits inside this repository, and `git apply` run against a tree it
// considers part of an enclosing repo resolves the patch paths somewhere else
// and exits 0 having changed nothing - so every patch below silently became a
// no-op and this script typechecked pristine code-server. Giving the scratch
// tree its own repository makes the paths mean what they say.
execFileSync("git", ["-C", SCRATCH, "init", "-q"], { stdio: "inherit" });

function gitScratch(...args) {
	return execFileSync("git", ["-C", SCRATCH, ...args], { encoding: "utf8" });
}

// The patches are pure LF and the sources are extracted as LF; a global
// core.autocrlf would rewrite them on the way through the index and every hunk
// would stop matching.
gitScratch("config", "core.autocrlf", "false");
gitScratch("config", "core.eol", "lf");

// Commit the pristine tree once it is extracted, so `git status` afterwards
// reports real modifications rather than a wall of untracked files - that is
// what lets applyAndConfirm() below tell "applied" from "did nothing".
function commitBaseline() {
	gitScratch("add", "-A");
	gitScratch(
		"-c",
		"user.name=composery",
		"-c",
		"user.email=composery@invalid",
		"commit",
		"-q",
		"-m",
		"pristine upstream"
	);
}

execFileSync(
	"git",
	[
		"-C",
		UPSTREAM,
		"-c",
		"core.autocrlf=false",
		"archive",
		"HEAD",
		"package.json",
		"package-lock.json",
		"tsconfig.json",
		"src",
		"typings",
		"-o",
		join(SCRATCH, "upstream.tar")
	],
	{ stdio: "inherit" }
);
execFileSync("tar", ["-xf", "upstream.tar"], {
	cwd: SCRATCH,
	stdio: "inherit"
});
rmSync(join(SCRATCH, "upstream.tar"));
commitBaseline();

// A patch that applies cleanly must change something. Comparing the tree before
// and after catches the silent no-op above returning in any other guise - an
// empty slice, a pathspec that stops matching, a patch reduced to nothing.
// A tree hash, not a file list: two patches touching the same file leave the
// same `git status` output, so only content tells "applied" from "did nothing".
function treeHash() {
	gitScratch("add", "-A");
	return gitScratch("write-tree").trim();
}

function applyAndConfirm(name, patchPath) {
	const before = treeHash();
	execFileSync("git", ["-C", SCRATCH, "apply", "-p1", patchPath], {
		stdio: "inherit"
	});
	const after = treeHash();
	if (before === after) {
		console.error(`${name} applied without changing the tree; it is a no-op.`);
		process.exit(1);
	}
}

// Slice the src/ sections out rather than passing `git apply --include=src/**`:
// git resolves that pathspec against the enclosing repository, and SCRATCH sits
// inside this one, so it matches nothing and the patch applies as a silent
// no-op (exit 0, tree untouched). Sections are delimited by their `--- a/`
// line (with or without a preceding `diff --git`), so the slice starts fresh
// at every file boundary.
function srcSectionsOf(patchPath) {
	const lines = readFileSync(patchPath, "utf8").split("\n");
	const kept = [];
	let section = [];
	const flush = () => {
		if (section.length === 0) {
			return;
		}
		// The section's file is the +++ side, or the --- side for deletions.
		const paths = section
			.filter((l) => l.startsWith("--- ") || l.startsWith("+++ "))
			.map((l) => /^(?:---|\+\+\+) (?:[ab]\/)?(\S+)/.exec(l)?.[1])
			.filter((p) => p && p !== "/dev/null");
		if (paths.some((p) => p.startsWith("src/"))) {
			kept.push(...section);
		}
		section = [];
	};
	let inBody = false;
	for (const line of lines) {
		const isGit = line.startsWith("diff --git ");
		// `--- ` opens a new section unless it completes the `diff --git` pair
		// above it; inside a hunk body a removed line starts with a single "-".
		const isFileMarker =
			line.startsWith("--- ") && !section.at(-1)?.startsWith("diff --git ");
		if (isGit || isFileMarker) {
			flush();
		}
		if (isGit || line.startsWith("--- ")) {
			inBody = true;
		}
		if (inBody) {
			section.push(line);
		}
	}
	flush();
	return kept.join("\n");
}

for (const [name, mode] of SERVER_PATCHES) {
	const patchPath = join(PACKAGE_ROOT, "patches", name);
	if (mode === "full") {
		applyAndConfirm(name, patchPath);
		continue;
	}
	const sections = srcSectionsOf(patchPath);
	if (!sections.trim()) {
		console.error(`${name} is listed as split but has no src/ sections.`);
		process.exit(1);
	}
	const sliced = join(SCRATCH, `${name}.src`);
	writeFileSync(sliced, `${sections}\n`);
	applyAndConfirm(name, sliced);
	rmSync(sliced);
}

for (const entry of readdirSync(join(OVERLAY, "src"))) {
	cpSync(join(OVERLAY, "src", entry), join(SCRATCH, "src", entry), {
		recursive: true
	});
}

run("node", [join(PACKAGE_ROOT, "scripts/rebrand.mjs"), SCRATCH]);

// pnpm injects npm_config_manage_package_manager_versions into child scripts,
// but npm does not own that option and warns today that it will reject it in a
// future major. The nested install is deliberately npm (upstream lockfile), so
// do not leak pnpm's private option across that package-manager boundary.
const npmEnv = Object.fromEntries(
	Object.entries(process.env).filter(
		([name]) =>
			name.toLowerCase() !== "npm_config_manage_package_manager_versions"
	)
);
const scratch = { cwd: SCRATCH };
run(
	isWindows ? process.execPath : "npm",
	[
		...(isWindows ? [NPM_CLI] : []),
		"ci",
		"--ignore-scripts",
		"--no-audit",
		"--no-fund"
	],
	{ ...scratch, env: npmEnv }
);
run(
	process.execPath,
	[
		join(SCRATCH, "node_modules/typescript/bin/tsc"),
		"--noEmit",
		"--project",
		"tsconfig.json"
	],
	scratch
);

rmSync(SCRATCH, { force: true, recursive: true });
