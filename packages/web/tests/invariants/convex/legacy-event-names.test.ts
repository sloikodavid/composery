import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

// Whose copy this pins, and why it cannot be derived away.
//
// `convex/boxes/rename.ts` lists the box event names that were replaced by the
// one grammar `boxEventType` derives. Its job is to rewrite the stored rows, and
// it says nothing about the code - so five workflows went on writing
// `box.stopped`, `box.suspended`, `box.unsuspended`, `box.started` and
// `box.update_not_needed` on every run, quietly re-creating the very rows the
// migration had just finished removing. Nothing failed; the tables simply never
// converged, and the only symptom was an audit history in two grammars.
//
// The type system now closes the ordinary route - `appendBoxEvent` takes a closed
// union - but the names can still be written as data: a validator argument, a
// string in a seed, a doc example. This reads the migration's own list rather
// than restating it, so a name added there is guarded the day it is added, and
// asserts no other file in the checkout writes one.
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MIGRATION = "convex/boxes/rename.ts";
// Readers, not writers. The migration is where these names legitimately live;
// this file quotes two of them to prove the scrape below still finds anything;
// and the `boxEventLabel` test names one to pin what the audit history shows for
// a row written before the migration ran. Each entry reads a legacy name to
// reason about it; none of them records an event.
const ALLOWED = [
	MIGRATION,
	// The migration's own behaviour test. It seeds each retired name into a test
	// database for the one purpose of watching the migration remove it, so it is
	// the migration's subject rather than a second writer of these rows - and
	// without it the rewrite that converges the fleet's audit history would be
	// run against production having never been executed once.
	"tests/behavior/convex/boxes/rename.test.ts",
	"tests/behavior/lib/boxes/operations.test.ts",
	"tests/invariants/convex/legacy-event-names.test.ts"
];

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory()) return sourceFiles(path);
		return /\.tsx?$/.test(entry.name) ? [path] : [];
	});
}

// The keys of `EVENT_RENAMES` - the left-hand side of each `"old": "new"` row -
// taken from the object literal itself so the pair cannot drift.
function retiredEventNames() {
	const source = readFileSync(`${ROOT}${MIGRATION}`, "utf8");
	const table = source.slice(
		source.indexOf("const EVENT_RENAMES"),
		source.indexOf("};", source.indexOf("const EVENT_RENAMES"))
	);
	return [...table.matchAll(/"([\w.]+)":\s*"[\w.]+"/g)].map(
		(match) => match[1]
	);
}

describe("retired box event names", () => {
	const retired = retiredEventNames();

	test("the migration's own list is what is being read", () => {
		// Guards the scrape: a regex that stopped matching would leave the check
		// below asserting nothing at all, forever.
		expect(retired.length).toBeGreaterThan(10);
		expect(retired).toContain("box.stopped");
		expect(retired).toContain("box.update_not_needed");
	});

	test("no source file writes one", () => {
		const offenders = ["app", "components", "convex", "lib", "tests"]
			.flatMap((dir) => sourceFiles(`${ROOT}${dir}`))
			.map((path) => path.slice(ROOT.length))
			.filter((path) => !ALLOWED.includes(path))
			.flatMap((path) => {
				const source = readFileSync(`${ROOT}${path}`, "utf8");
				return retired
					.filter((name) => source.includes(`"${name}"`))
					.map((name) => `${path}: ${name}`);
			});

		expect(offenders).toEqual([]);
	});
});
