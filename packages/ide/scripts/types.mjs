import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
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
// upstream src + the server and Node engine patches + overlay's new files. Sources come from
// git blobs (always LF) so the patch applies on Windows working trees too.
const UPSTREAM = join(PACKAGE_ROOT, "upstream");
const OVERLAY = join(PACKAGE_ROOT, "overlay");
const SERVER_DIFF = join(PACKAGE_ROOT, "patches/server.diff");
const NODE_ENGINE_DIFF = join(PACKAGE_ROOT, "patches/node-engine.diff");
const SCRATCH = join(
	REPO_ROOT,
	"tmp",
	`ide-overlay-typecheck-${Date.now()}-${process.pid}`
);
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

execFileSync("git", ["-C", SCRATCH, "apply", "-p1", SERVER_DIFF], {
	stdio: "inherit"
});
execFileSync("git", ["-C", SCRATCH, "apply", "-p1", NODE_ENGINE_DIFF], {
	stdio: "inherit"
});

for (const entry of readdirSync(join(OVERLAY, "src"))) {
	cpSync(join(OVERLAY, "src", entry), join(SCRATCH, "src", entry), {
		recursive: true
	});
}

run("node", [join(PACKAGE_ROOT, "scripts/rebrand.mjs"), SCRATCH]);

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
	scratch
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
