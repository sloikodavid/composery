/**
 * Holds the repository's environment files to two rules, because each mistake is silent.
 *
 * Every tool reads these from the directory it was started in, and none of them looks upwards, so
 * a `.env` file in a folder is loaded when somebody's shell happens to stand there and ignored
 * when it does not. They live at the top of the repository, where the commands run.
 *
 * An example file is how somebody learns that a variable exists, so a file with real values may
 * only set what its example names. It need not set all of them: a variable left out is a service
 * left as a fake, which is what an empty one means too.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dir, "..");
const exampleSuffix = ".example";
const skippedDirectories = new Set(["node_modules", "tmp"]);

function toVariables(file: string) {
	const full = path.join(repositoryRoot, file);
	if (!existsSync(full)) {
		return new Set<string>();
	}
	return new Set(
		readFileSync(full, "utf8")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "" && !line.startsWith("#"))
			.map((line) => line.split("=")[0]?.trim() ?? ""),
	);
}

function toMissing(from: Set<string>, to: Set<string>) {
	return [...from].filter((name) => !to.has(name)).sort();
}

/** Every `.env` file in the repository, so that one somewhere else is reported rather than read. */
function listEnvFiles(directory: string): string[] {
	const entries = readdirSync(path.join(repositoryRoot, directory), {
		withFileTypes: true,
	});
	return entries.flatMap((entry) => {
		const held = path.posix.join(directory, entry.name);
		if (entry.isDirectory()) {
			return entry.name.startsWith(".") || skippedDirectories.has(entry.name)
				? []
				: listEnvFiles(held);
		}
		return entry.name.startsWith(".env") ? [held] : [];
	});
}

const files = readdirSync(repositoryRoot).filter((file) =>
	file.startsWith(".env"),
);
const problems: string[] = [];

for (const file of listEnvFiles(".")) {
	if (path.posix.dirname(file) !== ".") {
		problems.push(
			`${file} is read only by a command started in that folder. Move it to the top of the repository.`,
		);
	}
}

for (const example of files.filter((file) => file.endsWith(exampleSuffix))) {
	const file = example.slice(0, -exampleSuffix.length);
	if (!files.includes(file)) {
		continue;
	}
	for (const name of toMissing(toVariables(file), toVariables(example))) {
		problems.push(`${file} sets ${name}, which ${example} does not name.`);
	}
}

for (const problem of problems) {
	console.error(problem);
}
if (problems.length > 0) {
	console.error(`Found ${problems.length} environment file problems.`);
	process.exit(1);
}
