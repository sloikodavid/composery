import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { listEnvironmentProblems } from "../../scripts/env";

const temporaryFolders: string[] = [];

afterEach(() => {
	for (const folder of temporaryFolders.splice(0)) {
		rmSync(folder, { recursive: true, force: true });
	}
});

test("environment checks include source names and value shapes", () => {
	const root = mkdtempSync(
		path.join(process.env.TEMP ?? ".", "composery-env-"),
	);
	temporaryFolders.push(root);
	mkdirSync(path.join(root, "convex"));
	writeFileSync(
		path.join(root, "convex", "settings.ts"),
		"process.env.EXAMPLE_URL; process.env.UNLISTED_VALUE;",
	);
	writeFileSync(
		path.join(root, ".env.local.example"),
		"EXAMPLE_URL=not-a-url\n",
	);
	writeFileSync(path.join(root, ".env.local"), "EXAMPLE_URL=not-a-url\n");

	const problems = listEnvironmentProblems(root);
	expect(problems).toContain(
		".env.local.example gives EXAMPLE_URL a value with the wrong shape.",
	);
	expect(problems).toContain(
		"No environment example names UNLISTED_VALUE, which source code reads.",
	);
});
