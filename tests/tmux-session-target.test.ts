import { readFileSync } from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

// tmux resolves `-t <name>` by exact match, then name prefix, then fnmatch. A
// bare target means `kill-session -t build` stops `build-2` when `build` is
// gone, and `has-session -t build` reports a session that is not there. Every
// target we pass must be `=`-anchored, on both sides of the split: the server
// creates the sessions, the extension attaches the editor to them.
//
// Two anchored forms exist because tmux takes two kinds of target. Verified
// against tmux 3.3a:
//
//   has-session/kill-session/attach-session  -t =name   (target-session)
//   set-option                               -t =name:  (target-PANE; a bare
//                                                        `=name` is rejected,
//                                                        and an unanchored
//                                                        `build` writes into
//                                                        `build-2`)
//
// The trailing `:` is load-bearing, not decoration - dropping it turns an exact
// target back into a prefix match, and dropping the `=` from set-option is the
// only way to make that call succeed while pointing at the wrong session.
const SOURCES = [
	"packages/ide/overlay/src/node/routes/api/session.ts",
	"packages/ide/overlay/lib/vscode/extensions/composery-api/extension.js"
];

// Matches the `-t` argument of a tmux invocation as it appears in an argument
// array: `"-t", <next token>`.
const TARGET_ARG = /"-t",\s*([^,\]\n]+)/g;
// The indirections allowed: session.ts's two helpers, which anchor the name.
const HELPERS = ["target(", "paneTarget("];

describe("tmux session targets", () => {
	for (const source of SOURCES) {
		it(`${source} anchors every -t target with =`, () => {
			const contents = readFileSync(path.join(process.cwd(), source), "utf8");
			const targets = [...contents.matchAll(TARGET_ARG)].map((match) =>
				(match[1] ?? "").trim()
			);
			expect(targets.length).toBeGreaterThan(0);
			for (const value of targets) {
				const anchored =
					/^[`"]=/.test(value) ||
					HELPERS.some((helper) => value.startsWith(helper));
				expect(anchored, `unanchored tmux target: ${value}`).toBe(true);
			}
			if (targets.some((value) => value.startsWith("target("))) {
				expect(contents).toMatch(
					/function target\(name: string\): string \{\s*return `=\$\{name\}`/
				);
			}
			if (targets.some((value) => value.startsWith("paneTarget("))) {
				expect(contents).toMatch(
					/function paneTarget\(name: string\): string \{\s*return `=\$\{name\}:`/
				);
			}
		});
	}

	it("set-option is the only call using the pane-target form", () => {
		const contents = readFileSync(
			path.join(
				process.cwd(),
				"packages/ide/overlay/src/node/routes/api/session.ts"
			),
			"utf8"
		);
		// paneTarget exists to work around one tmux quirk. If a second caller
		// appears, it is either a genuine pane target or someone reached for the
		// wrong helper to silence this file - both worth stopping on.
		const uses = [...contents.matchAll(/paneTarget\(/g)];
		expect(uses).toHaveLength(2); // the definition plus the set-option call
		expect(contents).toMatch(
			/"set-option",\s*\n?\s*"-t",\s*\n?\s*paneTarget\(/
		);
	});
});
