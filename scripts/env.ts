/**
 * Holds every environment file to its example, and every example to two rules.
 *
 * A variable somebody sets on their own machine and names nowhere is a silent, permanent mistake:
 * it works there, and the next person to set this up has no way to learn that it exists.
 *
 * An example holds a value for everything it names, never a blank. A blank says nothing about the
 * shape of what belongs there, and it is not a thing anybody can run: CI copies one of these files
 * as the app's own configuration, and a blank stopped the build the day one was emptied.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dir, "..");
const exampleSuffix = ".example";

function toValues(file: string) {
	const full = path.join(repositoryRoot, file);
	if (!existsSync(full)) {
		return new Map<string, string>();
	}
	return new Map(
		readFileSync(full, "utf8")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "" && !line.startsWith("#"))
			.map((line) => {
				const [name, ...rest] = line.split("=");
				return [name?.trim() ?? "", rest.join("=").trim()] as const;
			}),
	);
}

const problems = readdirSync(repositoryRoot)
	.filter((file) => file.endsWith(exampleSuffix))
	.flatMap((example) => {
		const named = toValues(example);
		const blank = [...named]
			.filter(([, value]) => value === "")
			.map(
				([name]) => `${example} leaves ${name} blank, which is not a value.`,
			);
		const unnamed = [
			...toValues(example.slice(0, -exampleSuffix.length)).keys(),
		]
			.filter((name) => !named.has(name))
			.map(
				(name) => `${example} does not name ${name}, which is set beside it.`,
			);
		return [...blank, ...unnamed].sort();
	});

for (const problem of problems) {
	console.error(problem);
}
if (problems.length > 0) {
	process.exit(1);
}
