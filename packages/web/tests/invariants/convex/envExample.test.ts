import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

// The .env.example.convex.* files are the single documented list of Convex-plane
// environment variables (see packages/web/AGENTS.md -> "Living setup docs"). This
// pins that list to the code: every variable the Convex source reads must appear
// in both example files, and neither file may carry a variable nothing reads. It
// fails loudly when the two drift, so a new requiredEnv()/process.env read cannot
// ship without its checklist entry - the exact gap that once hid CLERK_SECRET_KEY
// from the Convex examples.
//
// Scoped to the Convex plane on purpose: every Convex read is an explicit
// requiredEnv/optionalEnv/process.env literal, so both directions are decidable
// from source. The Next plane also gets vars implicitly from SDKs/CLIs (Clerk,
// Convex), which a source scan cannot see, so it is not checked here.

const convexDir = resolve(import.meta.dirname, "../../../convex");
const webDir = join(convexDir, "..");

// Names Convex or Node inject at runtime. They are never configured through the
// example checklist, so reading one must not demand an entry. Kept explicit so a
// future read of one fails visibly here rather than silently widening the set.
const RUNTIME_PROVIDED = new Set([
	"NODE_ENV",
	"CONVEX_CLOUD_URL",
	"CONVEX_SITE_URL"
]);

const READ_PATTERNS = [
	// requiredEnv("NAME") / optionalEnv("NAME")
	/(?:required|optional)Env\(\s*["'`]([A-Z][A-Z0-9_]*)["'`]/g,
	// process.env.NAME
	/process\.env\.([A-Z][A-Z0-9_]*)/g,
	// process.env["NAME"] - the quotes exclude the dynamic process.env[name] in env.ts
	/process\.env\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g
];

function envNamesReadByConvexSource() {
	const names = new Set<string>();
	for (const entry of readdirSync(convexDir, { recursive: true })) {
		const rel = String(entry);
		const normalized = rel.replaceAll("\\", "/");
		if (!normalized.endsWith(".ts")) continue;
		if (normalized.endsWith(".test.ts")) continue;
		if (normalized.startsWith("_generated/")) continue;
		const source = readFileSync(join(convexDir, rel), "utf8");
		for (const pattern of READ_PATTERNS) {
			for (const match of source.matchAll(pattern)) {
				if (!RUNTIME_PROVIDED.has(match[1])) names.add(match[1]);
			}
		}
	}
	return names;
}

function envNamesInExample(fileName: string) {
	const names = new Set<string>();
	for (const line of readFileSync(join(webDir, fileName), "utf8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(trimmed);
		if (match) names.add(match[1]);
	}
	return names;
}

const sorted = (names: Iterable<string>) => [...names].sort();

describe("Convex environment example checklist", () => {
	const codeReads = envNamesReadByConvexSource();

	test("finds the reads (a broken scanner would pass the equality below vacuously)", () => {
		// Stable anchors plus a floor: if the patterns ever match nothing, an empty
		// example file would wrongly compare equal, so make that failure show here.
		expect(codeReads.has("CLOUD_DOMAIN")).toBe(true);
		expect(codeReads.has("CLERK_SECRET_KEY")).toBe(true);
		expect(codeReads.size).toBeGreaterThan(15);
	});

	test.each([".env.example.convex.dev", ".env.example.convex.prod"])(
		"%s lists exactly the variables the Convex source reads",
		(fileName) => {
			const listed = envNamesInExample(fileName);
			const missing = sorted(
				[...codeReads].filter((name) => !listed.has(name))
			);
			const unread = sorted([...listed].filter((name) => !codeReads.has(name)));
			expect(
				{ missing, unread },
				`${fileName}: 'missing' are read in convex/ but absent from the file; 'unread' are in the file but read nowhere in convex/`
			).toEqual({ missing: [], unread: [] });
		}
	);
});
