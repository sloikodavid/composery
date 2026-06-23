import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UPSTREAM = join(REPO_ROOT, "packages/ide/upstream");

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

// code-server submodule + its nested lib/vscode (where our patches live).
// build.sh inits these for Linux builds; this makes them available off-build
// so patches can be authored/diffed on any platform.
run("git", ["submodule", "update", "--init", "--recursive"]);

if (!existsSync(join(UPSTREAM, "package.json"))) {
	console.error(
		"packages/ide/upstream is still empty after submodule init; check git output above."
	);
	process.exit(1);
}

run("pnpm", ["install"]);

console.log("\nSetup complete. Build with: packages/ide/build.sh (Linux)");
