import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

import ts from "typescript";

export const repoRoot = resolve(import.meta.dirname, "..", "..");

// GNU patch, 2.7 or newer. Version is part of the requirement, not trivia:
// 2.5.9 aborts ("Assertation failed!", patch.c:354) on a perfectly valid diff
// whose last hunk is followed by trailing `diff --git`/`index` lines, which is
// exactly what slicing one file's section out of a multi-file patch produces.
// The Windows CI runner has that build first on PATH (Strawberry Perl ships it
// in C:\Strawberry\c\bin), so "whatever is called patch" was not a usable rule.
// Delete the version gate once no supported runner carries a pre-2.7 build.
//
// Git for Windows bundles 2.7.6 in <git>/usr/bin, off PATH; that is the
// fallback, so the suite runs identically on every OS and a local pass predicts
// a CI pass.
function usableGnuPatch(binary: string): boolean {
	const probe = spawnSync(binary, ["--version"], { encoding: "utf8" });
	if (probe.status !== 0) return false;
	const version = /GNU patch (\d+)\.(\d+)/.exec(probe.stdout ?? "");
	if (!version) return false;
	return Number(version[1]) > 2 || Number(version[2]) >= 7;
}

export const patchBin = (() => {
	if (usableGnuPatch("patch")) return "patch";
	if (process.platform === "win32") {
		const gitCore = execFileSync("git", ["--exec-path"], {
			encoding: "utf8"
		}).trim();
		const bundled = resolve(
			gitCore,
			"..",
			"..",
			"..",
			"usr",
			"bin",
			"patch.exe"
		);
		if (existsSync(bundled) && usableGnuPatch(bundled)) return bundled;
	}
	throw new Error("GNU patch 2.7+ not found; the patch-stack tests need it.");
})();

export function applyPatch(patchFile: string, cwd: string): void {
	execFileSync(patchBin, ["-p1", "--fuzz=0", "-i", patchFile], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"]
	});
}

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

// A single added class method `private name(...) {...}`, brace-matched, returned
// without its modifier so it can be spliced into a stand-in class and exercised.
export function extractAddedMethod(patch: string, name: string): string {
	const source = addedLines(patch);
	// One rule for both `private name(` and `private async name(`; the `async` stays in
	// the returned body so it splices into a stand-in class unchanged.
	const start = source.search(new RegExp(`private (?:async )?${name}\\(`));
	if (start < 0) {
		throw new Error(`Could not find added method ${name}`);
	}

	let depth = 0;
	for (let i = source.indexOf("{", start); i < source.length; i++) {
		const char = source[i];
		if (char === "{") depth++;
		else if (char === "}") {
			depth--;
			if (depth === 0) {
				return source.slice(start, i + 1).replace(/^private /, "");
			}
		}
	}

	throw new Error(`Could not parse added method ${name}`);
}

// Every line a patch leaves behind inside its hunks - added and context both,
// with the leading marker stripped. This is what the file reads like after the
// patch applies, so constructs that open on an added line and close on a context
// line (a case block whose trailing brace was already there) stay balanced.
// Hunks are not contiguous with each other, so only use this within one hunk.
export function postImageLines(patch: string): string {
	return patch
		.split(/\r?\n/)
		.filter(
			(line) =>
				(line.startsWith("+") && !line.startsWith("+++")) ||
				line.startsWith(" ")
		)
		.map((line) => line.slice(1))
		.join("\n");
}

// The body of a `case <prefix>.<name>: { ... }` block the patch ships, returned
// without its braces so it can be spliced into a stand-in method. Channel request
// handlers only exist as case blocks, so this is the only way to exercise the
// dispatch the patch actually ships rather than a paraphrase of it.
export function extractAddedCaseBody(
	patch: string,
	name: string,
	prefix: string
): string {
	const source = postImageLines(patch);
	const marker = `case ${prefix}.${name}: {`;
	const start = source.indexOf(marker);
	if (start < 0) {
		throw new Error(`Could not find added case ${prefix}.${name}`);
	}

	const open = start + marker.length - 1;
	let depth = 0;
	for (let i = open; i < source.length; i++) {
		const char = source[i];
		if (char === "{") depth++;
		else if (char === "}") {
			depth--;
			if (depth === 0) {
				return source.slice(open + 1, i);
			}
		}
	}

	throw new Error(`Could not parse added case ${prefix}.${name}`);
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
