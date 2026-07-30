// Purging cannot derive one generic action from `box_id`: most rows are deleted,
// billing evidence is unlinked and retained, and snapshots hand off to provider
// cleanup. Convex also requires literal table names at each query boundary, so
// the explicit policy list cannot be generated from the schema; this invariant
// pins that unavoidable list to every schema table keyed by a box.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import schema from "@/convex/schema";

const tables = schema.tables as Record<
	string,
	{ validator?: { fields?: Record<string, unknown> } }
>;
const boxKeyedTables = Object.keys(tables).filter((name) =>
	Boolean(tables[name]?.validator?.fields?.box_id)
);
const source = readFileSync(
	new URL("../../../../convex/boxes/cleanup.ts", import.meta.url),
	"utf8"
);
const start = source.indexOf("export const purgeBox");
const end = source.indexOf("\nexport const ", start + 1);
const purgeBox = source.slice(start, end === -1 ? undefined : end);

describe("purgeBox table policy", () => {
	test("derives the box-keyed table set from schema validators", () => {
		expect(boxKeyedTables).toContain("box_health");
		expect(boxKeyedTables).toContain("box_operations");
		expect(start).toBeGreaterThan(-1);
	});

	test.each(boxKeyedTables)("names an explicit policy for %s", (table) => {
		expect(purgeBox).toContain(`.query("${table}")`);
	});
});
