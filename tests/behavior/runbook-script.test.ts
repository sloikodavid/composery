import { describe, expect, test } from "vitest";

import {
	readCronRows,
	renderDoc,
	renderTable
} from "../../scripts/runbook.mjs";
import { readRepoFile } from "../support/repo.ts";

// The operator's schedule table in docs/developing/web/maintenance.md is
// generated from convex/crons.ts, so the doc cannot drift from what actually
// runs. `check:runbook` compares the generated text to the committed file, which
// makes the whole thing pass or fail as one string - it says the doc is stale,
// never which part of the generator is wrong.
//
// These are the pieces underneath, exercised directly: the two pure renderers,
// and the reader's refusal to emit an empty table. Importing the module is also
// what proves the entry-point guard holds - without it, `check:runbook`'s own
// side effects would run here.

describe("the runbook schedule table", () => {
	test("pads every column to the widest cell", () => {
		const table = renderTable([
			{ job: "Reconcile", schedule: "Every 5 minutes" },
			{ job: "Purge", schedule: "Daily at 03:00" }
		]);

		expect(table.split("\n")).toEqual([
			"| Job       | Schedule        |",
			"| --------- | --------------- |",
			"| Reconcile | Every 5 minutes |",
			"| Purge     | Daily at 03:00  |"
		]);
	});

	test("keeps the header readable when every job name is short", () => {
		// The floors exist so a one-row table is still a table: without them the
		// separator would be narrower than the word "Schedule" above it.
		const table = renderTable([{ job: "Go", schedule: "Hourly" }]);

		expect(table.split("\n")[0]).toBe("| Job | Schedule |");
	});

	test("replaces only what sits between the markers", () => {
		const doc = [
			"# Maintenance",
			"",
			"<!-- cron-schedule:start -->",
			"",
			"stale table",
			"",
			"<!-- cron-schedule:finish -->",
			"",
			"Prose after the table."
		].join("\n");

		const rendered = renderDoc(doc, "| Job | Schedule |");

		expect(rendered).toContain("# Maintenance");
		expect(rendered).toContain("Prose after the table.");
		expect(rendered).not.toContain("stale table");
	});

	test("refuses a document with no markers rather than appending", () => {
		// Silently appending would leave two tables, one of them permanently
		// stale, and the check would then compare against the wrong one.
		expect(() => renderDoc("# Maintenance\n", "| Job |")).toThrow(
			/cron-schedule:start/
		);
	});

	test("reads the real crons, and every schedule reads as English", () => {
		const rows = readCronRows();

		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) {
			expect(row.schedule, row.job).toMatch(/^(Every |Hourly|Daily at )/);
			// An identifier reformatted into prose is the thing AGENTS.md forbids;
			// these are titled, not the raw cron name.
			expect(row.job[0], row.job).toBe(row.job[0]?.toUpperCase());
		}
	});

	test("the committed doc is what these pieces produce", () => {
		// The end-to-end claim `check:runbook` makes, asserted here from the parts
		// so a failure says which piece disagreed.
		const doc = readRepoFile("docs/developing/web/maintenance.md");

		expect(doc).toContain(renderTable(readCronRows()));
	});
});
