/**
 * Holds every environment file to its example. That mistake is silent and it is permanent: a
 * variable somebody sets on their own machine works there, is named nowhere, and the next person
 * to set this up has no way to learn that it exists. A file need not set everything its example
 * names, because a variable left out is a service left as a fake, which is what an empty one
 * means too.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dir, "..");
const exampleSuffix = ".example";

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

const problems = readdirSync(repositoryRoot)
	.filter((file) => file.endsWith(exampleSuffix))
	.flatMap((example) => {
		const named = toVariables(example);
		return [...toVariables(example.slice(0, -exampleSuffix.length))]
			.filter((name) => !named.has(name))
			.sort()
			.map(
				(name) => `${example} does not name ${name}, which is set beside it.`,
			);
	});

for (const problem of problems) {
	console.error(problem);
}
if (problems.length > 0) {
	process.exit(1);
}
