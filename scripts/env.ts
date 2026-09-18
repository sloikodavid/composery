/**
 * Holds the repository's environment files to two rules, because both mistakes are silent.
 *
 * Bun reads `.env` and `.env.test` into every `bun test`. A credential for a real service in one
 * of them would send a plain test run at that service, so no file Bun loads by itself may set a
 * variable that `.env.local.tests.example` names. Those files may hold anything else.
 *
 * An example file is how somebody learns that a variable exists, so a file with real values and
 * its example must name the same variables.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dir, "..");
const exampleSuffix = ".example";
const testCredentials = ".env.local.tests.example";
// What Bun loads into a test run on its own, whatever the run was asked to do.
const loadedByBun = [".env", ".env.test", ".env.test.local"];

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

const files = readdirSync(repositoryRoot).filter((file) =>
	file.startsWith(".env"),
);
const problems: string[] = [];
const credentials = toVariables(testCredentials);

for (const file of loadedByBun) {
	for (const name of toVariables(file)) {
		if (credentials.has(name)) {
			problems.push(
				`${file} sets ${name}, and Bun reads that file into every \`bun test\`. It belongs in .env.local.tests.`,
			);
		}
	}
}

for (const example of files.filter((file) => file.endsWith(exampleSuffix))) {
	const file = example.slice(0, -exampleSuffix.length);
	if (!files.includes(file)) {
		continue;
	}
	const named = toVariables(example);
	const held = toVariables(file);
	for (const name of toMissing(held, named)) {
		problems.push(`${file} sets ${name}, which ${example} does not name.`);
	}
	for (const name of toMissing(named, held)) {
		problems.push(`${example} names ${name}, which ${file} does not set.`);
	}
}

for (const problem of problems) {
	console.error(problem);
}
if (problems.length > 0) {
	console.error(`Found ${problems.length} environment file problems.`);
	process.exit(1);
}
