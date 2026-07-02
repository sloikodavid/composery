import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, run } from "./run.mjs";

run("git", ["submodule", "update", "--init", "--recursive"]);

if (!existsSync(join(REPO_ROOT, "packages/ide/upstream/package.json"))) {
	console.error(
		"packages/ide/upstream is still empty after submodule init; check git output above."
	);
	process.exit(1);
}

run("pnpm", ["install"], { shell: process.platform === "win32" });

console.log("\nSetup complete. Build with: packages/ide/build.sh (Linux)");
