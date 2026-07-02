import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, run } from "./run.mjs";

// Typecheck the IDE server tree exactly as build.sh assembles it: pristine
// code-server src + patches/server.diff + overlay's new files. Sources come from
// git blobs (always LF) so the patch applies on Windows working trees too.
const UPSTREAM = join(REPO_ROOT, "packages/ide/upstream");
const OVERLAY = join(REPO_ROOT, "packages/ide/overlay");
const SERVER_DIFF = join(REPO_ROOT, "packages/ide/patches/server.diff");
const SCRATCH = join(REPO_ROOT, "tmp/ide-overlay-typecheck");
const isWindows = process.platform === "win32";

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

for (const entry of readdirSync(join(OVERLAY, "src"))) {
	cpSync(join(OVERLAY, "src", entry), join(SCRATCH, "src", entry), {
		recursive: true
	});
}

const shell = { cwd: SCRATCH, shell: isWindows };
run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], shell);
run("npx", ["tsc", "--noEmit", "--project", "tsconfig.json"], shell);

rmSync(SCRATCH, { force: true, recursive: true });
