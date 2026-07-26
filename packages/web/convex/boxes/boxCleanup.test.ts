import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import schema from "../schema";

// `purgeBox` is the end of a box's life: after it, nothing box-shaped is supposed
// to remain. Every table keyed by `box_id` therefore has to be handled there, and
// the list of those tables is not something to remember - it is derivable from the
// schema, so derive it.
//
// This exists because `box_health` was missed. It was the one `box_id` table
// `purgeBox` never touched, so a row per box ever created survived the purge that
// exists to leave nothing behind. Nothing failed; the leak was only visible by
// reading both lists side by side, which is exactly the comparison a test should
// be doing instead of a person.
function tablesKeyedByBox() {
	const tables = schema.tables as Record<
		string,
		{ validator?: { fields?: Record<string, unknown> } }
	>;
	return Object.keys(tables).filter((name) =>
		Boolean(tables[name]?.validator?.fields?.box_id)
	);
}

function purgeBoxSource() {
	const source = readFileSync(
		new URL("./boxCleanup.ts", import.meta.url),
		"utf8"
	);
	const start = source.indexOf("export const purgeBox");
	expect(start).toBeGreaterThan(-1);
	const end = source.indexOf("\nexport const ", start + 1);
	return source.slice(start, end === -1 ? undefined : end);
}

describe("purgeBox covers every box-keyed table", () => {
	const tables = tablesKeyedByBox();
	const source = purgeBoxSource();

	// Without this the test below passes vacuously if the schema import ever stops
	// exposing field validators - it would derive an empty list and assert nothing.
	it("derives the table list from the schema at all", () => {
		expect(tables).toContain("box_health");
		expect(tables).toContain("box_operations");
		expect(tables.length).toBeGreaterThanOrEqual(10);
	});

	// Read, not deleted: the tables are not all disposed of the same way. Checkout
	// intents are kept and unlinked for billing evidence, and snapshots hand off to
	// a scheduled Hetzner delete. What matters is that purge has an answer for each
	// one, not that the answer is `delete`.
	it.each(tables)("reads %s", (table) => {
		expect(source).toContain(`.query("${table}")`);
	});
});
