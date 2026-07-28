import { existsSync } from "node:fs";
import { posix, resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { readRepoFile, repoRoot } from "../../../../tests/support/repo.ts";
import {
	addedLines,
	evaluatePatchSnippets,
	extractAddedMethod,
	postImageLines
} from "../support/patch.ts";

const patch = readRepoFile("packages/ide/patches/narrow.diff");

// The hunks for one patched file. Assertions that name a symbol are otherwise
// answered by whichever file happens to mention it first - narrow.diff imports
// isNarrow into two of them.
function section(path: string): string {
	const start = patch.indexOf(`--- a/${path}\n`);
	if (start < 0) throw new Error(`narrow.diff does not touch ${path}`);
	const rest = patch.slice(start + 1);
	const next = rest.indexOf("\n--- a/");
	return next < 0 ? rest : rest.slice(0, next);
}

function upstreamFile(path: string): string {
	return readRepoFile(`packages/ide/upstream/${path}`);
}

const editorPart =
	"lib/vscode/src/vs/workbench/browser/parts/editor/editorPart.ts";
const editorGroupColumn =
	"lib/vscode/src/vs/workbench/services/editor/common/editorGroupColumn.ts";

describe("narrow viewport keeps one editor group", () => {
	// The gate only covers splits that ask the part for a group. Upstream grows the
	// grid in exactly three places, and the other two are the grid being built - the
	// first group at boot and each group of a restored layout - which the merge
	// covers instead. A fourth site is a split the gate would never see, so pin the
	// set rather than trusting that addGroup is still the whole story.
	test("addGroup is the only split upstream can produce", () => {
		const source = upstreamFile(editorPart);

		expect(source.match(/this\.doCreateGroupView\(/g)).toHaveLength(3);
		expect(source).toContain(
			"newGroupView = this.doCreateGroupView(groupToCopy);"
		);
		expect(source).toContain("const initialGroup = this.doCreateGroupView();");
		expect(source).toContain(
			"groupView = this.doCreateGroupView(serializedEditorGroup, options);"
		);
	});

	// Position is the whole point: a gate that returns after the group is built
	// would leave the split on screen and only look like it was refused.
	test("the gate returns before a group is created", () => {
		expect(postImageLines(section(editorPart))).toMatch(
			/const locationView = this\.assertGroupView\(location\);\n(?:\s*\/\/.*\n)*\s*if \(!groupToCopy && isNarrow\(getWindow\(locationView\.element\)\)\) \{\n\s*return locationView;\n\s*\}\n\n\s*let newGroupView: IEditorGroupView;/
		);
	});

	// A group carrying editors is the one thing the gate must not refuse: moveGroup
	// asks for it precisely to hold the editors of the group it is about to remove.
	test("a group being copied is exempt so no editors are dropped", () => {
		expect(upstreamFile(editorPart)).toContain(
			"movedView = targetView.groupsView.addGroup(targetView, direction, sourceView);"
		);
		expect(addedLines(section(editorPart))).toContain("if (!groupToCopy && ");
	});

	// Upstream reads back the group the previous pass was supposed to create. While
	// the window is narrow nothing created it, so without the guard an extension
	// asking for a third view column throws "Invalid editor group provided!".
	// When upstream guards this itself, delete ours.
	test("column walking stops instead of dereferencing a group it never got", () => {
		expect(upstreamFile(editorGroupColumn)).toContain(
			"editorGroupService.addGroup(editorGroups[i - 1]"
		);
		expect(postImageLines(section(editorGroupColumn))).toMatch(
			/if \(!editorGroups\[i\]\) \{\n(?:\s*\/\/.*\n)*\s*if \(!editorGroups\[i - 1\]\) \{\n\s*break;\n\s*\}/
		);
	});

	// A relative specifier that resolves nowhere only fails in the image build's
	// typecheck, minutes later. Every import the patch introduces has to name a
	// file that exists in the assembled tree - overlay or upstream.
	test("every import the patch adds names a file that exists", () => {
		const unresolved: string[] = [];

		for (const line of patch.split("\n")) {
			if (line.startsWith("--- a/")) continue;
			const specifier = /^\+import .* from '(\.[^']*)';$/.exec(line)?.[1];
			if (!specifier) continue;

			// Which file the import lands in: the section header above this line.
			const before = patch.slice(0, patch.indexOf(line));
			const host = /--- a\/(\S+)\n(?![\s\S]*\n--- a\/)/.exec(before)?.[1];
			if (!host) throw new Error(`no file section for ${specifier}`);

			const target = posix
				.join(posix.dirname(host), specifier)
				.replace(/\.js$/, ".ts");
			const found = ["packages/ide/overlay", "packages/ide/upstream"].some(
				(root) => existsSync(resolve(repoRoot, root, target))
			);
			if (!found) unresolved.push(`${host} -> ${specifier}`);
		}

		expect(unresolved).toEqual([]);
	});

	// The merge is the half that removes a split the gate never saw. Exercise the
	// shipped scheduler rather than a paraphrase: it has to defer (the grid cannot
	// be mutated inside the layout pass that noticed it), coalesce a burst of
	// layouts into one merge, and re-read its condition when it finally runs.
	test("the merge is deferred, coalesced and re-checked", () => {
		const harness = `
			let narrow = true;
			const microtasks = [];
			const queueMicrotask = (fn) => { microtasks.push(fn); };
			const getWindow = (_) => ({});
			const isNarrow = (_) => narrow;

			class StandInPart {
				element = {};
				activeGroup = "active";
				count = 2;
				merged = [];
				narrowGroupsScheduled = false;
				mergeAllGroups(target) { this.merged.push(target); }
				${extractAddedMethod(patch, "hasSplitNarrowGroups")}
				${extractAddedMethod(patch, "scheduleNarrowGroups")}
			}

			const setNarrow = (value) => { narrow = value; };
			const pending = () => microtasks.length;
			const flush = () => { for (const fn of microtasks.splice(0)) fn(); };
		`;

		const { StandInPart, setNarrow, pending, flush } = evaluatePatchSnippets<{
			StandInPart: new () => {
				count: number;
				merged: string[];
				scheduleNarrowGroups(): void;
			};
			setNarrow: (value: boolean) => void;
			pending: () => number;
			flush: () => void;
		}>([harness], ["StandInPart", "setNarrow", "pending", "flush"]);

		// Deferred, and a burst of layouts is one merge, not one each.
		const part = new StandInPart();
		part.scheduleNarrowGroups();
		part.scheduleNarrowGroups();
		expect(pending()).toBe(1);
		expect(part.merged).toEqual([]);
		flush();
		expect(part.merged).toEqual(["active"]);

		// Re-checked: the split can be gone by the time the microtask runs.
		const closed = new StandInPart();
		closed.scheduleNarrowGroups();
		closed.count = 1;
		flush();
		expect(closed.merged).toEqual([]);

		// A disposed part has no groups left, so nothing is scheduled at all.
		const disposed = new StandInPart();
		disposed.count = 0;
		disposed.scheduleNarrowGroups();
		expect(pending()).toBe(0);

		// A wide window keeps its splits.
		setNarrow(false);
		const wide = new StandInPart();
		wide.scheduleNarrowGroups();
		expect(pending()).toBe(0);
		setNarrow(true);
	});
});
