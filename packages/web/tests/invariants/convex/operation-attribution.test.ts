import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

// ---------------------------------------------------------------------------
// Every endpoint that starts a box operation has its attribution and its
// idempotency key driven by a table.
//
// An operation carries a `trigger`, and automatic repair reads that field alone
// to decide whether a person is already working on a box. A console action
// recorded as the owner's tells the sweep to keep away from a box nobody is
// holding; an owner action recorded as staff's tells it the opposite. Beside it
// sits an idempotency key that has to name the box, or one box's press is
// absorbed as another's.
//
// Both are one literal per endpoint, in files where an endpoint is written by
// copying the one above it - so the behaviour tests drive them from a table
// rather than one test each. What a table cannot do is notice an endpoint added
// afterwards: it would simply not be in the table, and every case would still
// pass. This pins the table against the endpoints that actually start work.
//
// The two lists cannot be derived from one another - Convex declarations on one
// side, call shapes and starting statuses on the other - so this pins the pair.
// ---------------------------------------------------------------------------

const read = (path: string) =>
	readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// An endpoint starts work iff its handler reaches one of the three functions
// that open an operation. Read from the declaration body rather than from a
// name, because the name is exactly what a copied endpoint gets wrong.
function operationEndpoints(source: string) {
	const declaration =
		/export const (\w+) = (?:query|mutation|action)\(\{([\s\S]*?)\n\}\);/g;
	return [...source.matchAll(declaration)]
		.filter(([, , body]) =>
			/start(?:BoxOperation|BoxSuspension|ManualSnapshot)\(/.test(
				body as string
			)
		)
		.map(([, name]) => name as string);
}

function tableEntries(source: string, name: string) {
	const table = new RegExp(
		`const ${name} = \\{([\\s\\S]*?)\\n\\t\\} as const;`
	);
	const body = table.exec(source)?.[1] ?? "";
	return [...body.matchAll(/^\t\t(\w+):/gm)].map((match) => match[1] as string);
}

// Endpoints whose key deliberately carries more than the box, so their repeat
// behaviour differs and they are driven by their own block instead.
const OWN_BLOCK = {
	user: {
		changeSlug: "keys on the new name too, so a second name is a new request",
		restoreSnapshot: "keys on the snapshot too, for the same reason"
	},
	staff: {
		grantComp: "creates the box it then operates on",
		restoreSnapshot: "keys on the snapshot too",
		revokeComp: "deletes the box, under the shared deletion key"
	}
} as const;

const SURFACES = [
	{
		label: "the owner's",
		source: "../../../convex/user/boxes.ts",
		test: "../../behavior/convex/user/boxes.test.ts",
		table: "REPEATS",
		exempt: OWN_BLOCK.user
	},
	{
		label: "the console's",
		source: "../../../convex/staff/boxes.ts",
		test: "../../behavior/convex/staff/boxes.test.ts",
		table: "CONSOLE",
		exempt: OWN_BLOCK.staff
	}
] as const;

describe.each(SURFACES)(
	"$label operation endpoints are driven by a table",
	({ source, test: testPath, table, exempt }) => {
		const endpoints = () => operationEndpoints(read(source));
		const covered = () => tableEntries(read(testPath), table);

		// A green run has to mean the lists matched, not that a regex stopped
		// finding either of them.
		test("both lists are still being read", () => {
			expect(endpoints().length).toBeGreaterThan(5);
			expect(covered().length).toBeGreaterThan(5);
		});

		test("the table names every endpoint that starts work", () => {
			expect([...covered(), ...Object.keys(exempt)].sort()).toEqual(
				endpoints().sort()
			);
		});

		// An exemption is a claim that the endpoint is covered somewhere else in
		// the same file. Left unchecked it would be the easy way to silence this
		// test, so each one has to point at a block that exists.
		test("every exemption names an endpoint the file still covers", () => {
			const behaviour = read(testPath);
			for (const name of Object.keys(exempt)) {
				expect(behaviour).toMatch(new RegExp(`\\b${name}\\b`));
			}
		});
	}
);
