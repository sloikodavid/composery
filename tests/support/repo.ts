import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Locating and reading the checkout. Available to any test: loading a module a
// bundler would otherwise hide is legitimate everywhere, and reading a file to
// assert about its text is confined by which support module a test may import,
// not by whether it can find the repository. See docs/developing/testing.md.
export const repoRoot = resolve(import.meta.dirname, "..", "..");

export function readRepoFile(path: string): string {
	return readFileSync(resolve(repoRoot, path), "utf8");
}
