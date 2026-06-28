import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UPSTREAM = join(REPO_ROOT, "packages/ide/upstream");
const OVERLAY = join(REPO_ROOT, "packages/ide/overlay");
const SCRATCH = join(REPO_ROOT, "tmp/ide-overlay-typecheck");
const isWindows = process.platform === "win32";
const commandSuffix = isWindows ? ".cmd" : "";

function run(command, args, options = {}) {
	console.log(`\n$ ${[command, ...args].join(" ")}`);
	const result = spawnSync(command, args, {
		cwd: REPO_ROOT,
		shell: isWindows,
		stdio: "inherit",
		...options
	});
	if (result.error) {
		console.error(result.error.message);
		process.exit(1);
	}
	if (result.status !== 0) process.exit(result.status ?? 1);
}

function ensurePath(path, label) {
	if (!existsSync(path)) {
		console.error(`${label} is missing: ${path}`);
		process.exit(1);
	}
}

function copyContents(source, destination) {
	mkdirSync(destination, { recursive: true });
	for (const entry of readdirSync(source)) {
		cpSync(join(source, entry), join(destination, entry), { recursive: true });
	}
}

ensurePath(join(UPSTREAM, "package.json"), "code-server upstream package");
ensurePath(
	join(UPSTREAM, "package-lock.json"),
	"code-server upstream lockfile"
);
ensurePath(join(UPSTREAM, "tsconfig.json"), "code-server upstream tsconfig");
ensurePath(join(UPSTREAM, "src"), "code-server upstream source");
ensurePath(join(OVERLAY, "src"), "IDE overlay source");

rmSync(SCRATCH, { force: true, recursive: true });
mkdirSync(join(SCRATCH, "src"), { recursive: true });

for (const file of ["package.json", "package-lock.json", "tsconfig.json"]) {
	cpSync(join(UPSTREAM, file), join(SCRATCH, file));
}

copyContents(join(UPSTREAM, "src"), join(SCRATCH, "src"));
copyContents(join(OVERLAY, "src"), join(SCRATCH, "src"));

const typings = join(UPSTREAM, "typings");
if (existsSync(typings) && statSync(typings).isDirectory()) {
	cpSync(typings, join(SCRATCH, "typings"), { recursive: true });
}

run(
	`npm${commandSuffix}`,
	["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
	{
		cwd: SCRATCH
	}
);
run(`npx${commandSuffix}`, ["tsc", "--noEmit", "--project", "tsconfig.json"], {
	cwd: SCRATCH
});

rmSync(SCRATCH, { force: true, recursive: true });
