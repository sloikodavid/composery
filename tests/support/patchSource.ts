import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

import ts from "typescript";

export const repoRoot = resolve(import.meta.dirname, "..", "..");

export function readRepoFile(path: string): string {
	return readFileSync(resolve(repoRoot, path), "utf8");
}

// All lines a patch adds, with the leading "+" stripped.
export function addedLines(patch: string): string {
	return patch
		.split(/\r?\n/)
		.filter((line) => line.startsWith("+") && !line.startsWith("+++"))
		.map((line) => line.slice(1))
		.join("\n");
}

// A single added `function name(...) {...}` declaration, brace-matched.
export function extractAddedFunction(patch: string, name: string): string {
	const source = addedLines(patch);
	const start = source.indexOf(`function ${name}`);
	if (start < 0) {
		throw new Error(`Could not find added function ${name}`);
	}

	let depth = 0;
	for (let i = source.indexOf("{", start); i < source.length; i++) {
		const char = source[i];
		if (char === "{") depth++;
		else if (char === "}") {
			depth--;
			if (depth === 0) {
				return source.slice(start, i + 1);
			}
		}
	}

	throw new Error(`Could not parse added function ${name}`);
}

// An added `const name = ...;` statement (single or multi-line, ends at `;`
// on a line boundary).
export function extractAddedConst(patch: string, name: string): string {
	const source = addedLines(patch);
	const start = source.indexOf(`const ${name}`);
	if (start < 0) {
		throw new Error(`Could not find added const ${name}`);
	}
	const end = source.indexOf(";\n", start);
	if (end < 0) {
		throw new Error(`Could not parse added const ${name}`);
	}
	return source.slice(start, end + 1);
}

// Compile extracted TypeScript snippets and expose the named bindings, so tests
// exercise the exact code the patch ships instead of a copy that can drift.
export function evaluatePatchSnippets<T>(
	snippets: string[],
	bindings: string[]
): T {
	const source = [
		...snippets,
		`globalThis.__exports = { ${bindings.join(", ")} };`
	].join("\n");
	const js = ts.transpileModule(source, {
		compilerOptions: { target: ts.ScriptTarget.ES2022 }
	}).outputText;
	const context = vm.createContext({ URL, URLSearchParams });
	vm.runInContext(js, context);
	return (context as { __exports?: T }).__exports as T;
}
