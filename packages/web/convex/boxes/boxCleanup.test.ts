import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { DELETE_ATTEMPTS_BEFORE_ALERT, deleteNeedsPerson } from "./boxCleanup";
import { SUBSCRIPTION_RECONCILIATION_STATUSES } from "./boxQueries";

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

describe("deleteNeedsPerson", () => {
	// The incident this sweep exists for had exactly one failed delete, on a box
	// whose Hetzner teardown had already finished. A rule that only reacted to
	// repeat failures would have stayed silent on it - which is what happened.
	it("does not call one failure a standing problem", () => {
		expect(deleteNeedsPerson(1)).toBe(false);
	});

	it("escalates at the threshold and not before", () => {
		expect(deleteNeedsPerson(DELETE_ATTEMPTS_BEFORE_ALERT - 1)).toBe(false);
		expect(deleteNeedsPerson(DELETE_ATTEMPTS_BEFORE_ALERT)).toBe(true);
		expect(deleteNeedsPerson(DELETE_ATTEMPTS_BEFORE_ALERT + 10)).toBe(true);
	});
});

describe("finishFailedDeletions never abandons a box", () => {
	// The threshold raises an alert; it must not also stop the retry. A paid box
	// has no manual teardown lever at all - `revokeComp` refuses anything that is
	// not a comp - so a sweep that gave up would strand it permanently, and the
	// usual reason a delete keeps failing (Hetzner unreachable) is exactly the
	// kind that clears on its own.
	it("starts a delete on every pass, including past the alert threshold", () => {
		const source = readFileSync(
			new URL("./boxCleanup.ts", import.meta.url),
			"utf8"
		);
		const start = source.indexOf("export const finishFailedDeletions");
		expect(start).toBeGreaterThan(-1);
		const sweep = source.slice(
			start,
			source.indexOf("\nexport const ", start + 1)
		);

		expect(sweep).toContain("deleteNeedsPerson");
		expect(sweep).toContain("startBoxOperation");
		// A `continue` after the alert is the exact regression this guards: it would
		// skip the retry for precisely the boxes that most need it.
		expect(sweep).not.toContain("continue;");
	});
});

describe("delete_failed has one owner", () => {
	// If subscription reconciliation started reaching delete_failed boxes again,
	// two hourly sweeps would re-drive the same deletion under different triggers
	// and the box's history would stop saying which one was finishing it.
	it("leaves delete_failed to the sweep that finishes deletions", () => {
		expect(SUBSCRIPTION_RECONCILIATION_STATUSES).not.toContain("delete_failed");
	});

	// The exclusion has to stay narrow: a box that is merely broken is not on its
	// way out, and its subscription still has to be checked.
	it("still reconciles boxes that failed something other than deletion", () => {
		expect(SUBSCRIPTION_RECONCILIATION_STATUSES).toContain("repair_failed");
		expect(SUBSCRIPTION_RECONCILIATION_STATUSES).toContain(
			"provisioning_failed"
		);
		expect(SUBSCRIPTION_RECONCILIATION_STATUSES).toContain("running");
	});
});
