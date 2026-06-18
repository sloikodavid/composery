import {
	appendFileSync,
	copyFileSync,
	mkdtempSync,
	readFileSync,
	rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCKERFILE = readFileSync(join(REPO_ROOT, "Dockerfile"), "utf8");

function dockerArg(name) {
	const match = new RegExp(`^ARG ${name}=(\\S+)`, "m").exec(DOCKERFILE);
	if (!match) throw new Error(`Dockerfile is missing ARG ${name}.`);
	return match[1];
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { stdio: "inherit", ...options });
	if (result.status === 0) return;
	throw new Error(`${command} ${args.join(" ")} failed.`);
}

function output(command, args, options = {}) {
	return execFileSync(command, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
		...options
	}).trim();
}

run("git", ["--version"]);
run("quilt", ["--version"]);

const version = dockerArg("CODE_SERVER_VERSION");
const commit = dockerArg("CODE_SERVER_COMMIT");
const repository = dockerArg("CODE_SERVER_REPOSITORY");
const scratch = mkdtempSync(join(tmpdir(), "composery-code-server-patches-"));
const source = join(scratch, "code-server");

try {
	run("git", [
		"clone",
		"--branch",
		`v${version}`,
		"--depth",
		"1",
		repository,
		source
	]);

	const actualCommit = output("git", ["rev-parse", "HEAD"], { cwd: source });
	if (actualCommit !== commit) {
		throw new Error(
			`code-server commit mismatch: expected ${commit}, got ${actualCommit}.`
		);
	}

	run("git", ["submodule", "update", "--init", "--depth", "1"], {
		cwd: source
	});

	const localPatches = join(REPO_ROOT, "vendor/code-server/patches");
	const patchNames = readFileSync(join(localPatches, "series"), "utf8")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));

	for (const patchName of patchNames) {
		copyFileSync(
			join(localPatches, patchName),
			join(source, "patches", patchName)
		);
	}

	appendFileSync(
		join(source, "patches/series"),
		`\n${patchNames.join("\n")}\n`
	);
	run("quilt", ["push", "-a"], { cwd: source });
} finally {
	rmSync(scratch, { force: true, recursive: true });
}
