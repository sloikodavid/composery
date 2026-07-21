import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const eas = JSON.parse(readFileSync(resolve(projectRoot, "eas.json"), "utf8"));
const version = eas.cli?.version;
const childEnv = { ...process.env };
delete childEnv.npm_config_manage_package_manager_versions;

if (!/^\d+\.\d+\.\d+$/.test(version)) {
	throw new Error(`eas.json must pin an exact EAS CLI version, got ${version}`);
}

const npxArgs = ["--yes", `eas-cli@${version}`, ...process.argv.slice(2)];
let command = "npx";
let args = npxArgs;
if (process.platform === "win32") {
	// .cmd shims require a shell, where user-supplied CLI arguments would be
	// reinterpreted as command text. Invoke npm's JS entry point directly.
	const npxCli = resolve(
		dirname(process.execPath),
		"node_modules/npm/bin/npx-cli.js"
	);
	if (!existsSync(npxCli)) {
		throw new Error(`Could not find npm's npx CLI beside Node: ${npxCli}`);
	}
	command = process.execPath;
	args = [npxCli, ...npxArgs];
}
const result = spawnSync(command, args, {
	cwd: projectRoot,
	env: childEnv,
	stdio: "inherit"
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
