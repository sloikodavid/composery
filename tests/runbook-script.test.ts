import { describe, expect, test } from "vitest";

import { readCronRows, renderDoc, renderTable } from "../scripts/runbook.mjs";

import { readRepoFile } from "./support/patchSource.ts";

const DOC = "docs/developing/web/maintenance.md";

describe("cron runbook generation", () => {
	const rows = readCronRows();

	// The generator's failure mode is a regex that quietly stops matching: it
	// would render an empty table, splice it in, and report success - leaving an
	// operator with a runbook that says no scheduled work exists. `readCronRows`
	// throws on nothing found; this makes sure the throw is not what is keeping
	// the suite green either.
	test("reads every cron the schedule declares", () => {
		const declared = [
			...readRepoFile("packages/web/convex/crons.ts").matchAll(
				/crons\.(?:interval|hourly|daily)\(/g
			)
		].length;

		expect(declared).toBeGreaterThan(10);
		expect(rows).toHaveLength(declared);
	});

	// A schedule is only useful if it says when. Rendering "undefined" or an
	// empty cell would be worse than failing, so the generator throws instead -
	// this pins that every row it does emit is complete.
	test("every row states a job and a schedule", () => {
		for (const row of rows) {
			expect(row.job, JSON.stringify(row)).toMatch(/^[A-Z]/);
			expect(row.schedule, row.job).toMatch(
				/^(Every \d+ minutes?|Hourly at :\d{2}|Daily at \d{2}:\d{2})$/
			);
		}
	});

	// The timing is written as a shared constant in at least one cron, which is
	// the better way to write it. If the generator ever stopped resolving those
	// it would throw rather than guess - but the useful assertion is that the
	// resolved value is the real one.
	test("resolves a schedule written as a shared constant", () => {
		const minutes = /METRICS_POLL_INTERVAL_MINUTES = (\d+)/.exec(
			readRepoFile("packages/web/convex/boxes/boxMetrics.ts")
		)?.[1];

		expect(minutes).toBeDefined();
		expect(rows.find((row) => row.job === "Poll box metrics")?.schedule).toBe(
			`Every ${minutes} minutes`
		);
	});

	test("the committed table matches what the generator produces", () => {
		expect(readRepoFile(DOC)).toContain(renderTable(rows));
	});

	// Splicing is the one place this can corrupt a document rather than just get
	// a row wrong, so it must refuse a file it cannot find its own markers in.
	test("refuses to write into a document without markers", () => {
		expect(() =>
			renderDoc("# Maintenance\n\nNo markers here.\n", "|table|")
		).toThrow(/must contain/);
	});
});
