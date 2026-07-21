import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const NAV = join(SRC, "lib", "nav.ts");

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return /\.tsx?$/.test(path) && !path.endsWith(".test.ts") ? [path] : [];
	});
}

describe("screen exits", () => {
	// Leaving is always the tail of something asynchronous - a save that lands, a
	// QR code that decodes, the IDE answering a back press - and by then the user
	// may have left already. Navigating again from a screen that is no longer
	// showing acts on whatever replaced it: it pops the instances list, or replaces
	// it, and the next back press quits the app from a screen nobody navigated to.
	// useScreenExit is where that is handled, so it is where every exit goes.
	test("no screen leaves except through useScreenExit", () => {
		const leaving = /router\.(back|replace|dismiss|dismissAll|dismissTo)\s*\(/;
		const offenders = sourceFiles(SRC)
			.filter((path) => path !== NAV)
			.filter((path) => leaving.test(readFileSync(path, "utf8")))
			.map((path) => path.slice(SRC.length));

		expect(offenders).toEqual([]);
	});

	// push() adds a screen and is nobody's exit, so it stays free.
	test("the rule is about leaving, not about navigating", () => {
		expect(readFileSync(join(SRC, "app", "index.tsx"), "utf8")).toContain(
			"router.push"
		);
	});
});
