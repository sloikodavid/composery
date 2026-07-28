import { describe, expect, test } from "vitest";

import { readRepoFile } from "../../../../tests/support/repo.ts";
import {
	addedLines,
	evaluatePatchSnippets,
	extractAddedMethod
} from "../support/patch.ts";

const patch = readRepoFile("packages/ide/patches/touch.diff");
const added = addedLines(patch);

type Item = {
	row: { domNode: { contains(active: unknown): boolean } } | null;
};

type Harness = {
	items: Item[];
	focusPinnedItem: Item | undefined;
	updated: Array<{ item: Item; index: number }>;
	removed: Array<{ index: number; onScroll: boolean | undefined }>;
	_getActiveElementRevealDelta(
		elementTop: number,
		elementBottom: number,
		viewportTop: number,
		viewportBottom: number
	): number;
	_restoreFocusPinnedItem(index: number): boolean;
	_releaseInactiveFocusPinnedItem(
		renderRange: { start: number; end: number },
		activeElement: unknown,
		onScroll?: boolean
	): void;
	_disposeFocusPinnedItem(onScroll?: boolean): void;
};

const { FocusPinHarness } = evaluatePatchSnippets<{
	FocusPinHarness: new (items: Item[], pinned: Item | undefined) => Harness;
}>(
	[
		`class FocusPinHarness {
			updated = [];
			removed = [];

			constructor(items, pinned) {
				this.items = items;
				this.focusPinnedItem = pinned;
			}

			updateItemInDOM(item, index) {
				this.updated.push({ item, index });
			}

			removeItemFromDOM(index, onScroll) {
				this.removed.push({ index, onScroll });
				this.items[index].row = null;
			}

			${extractAddedMethod(patch, "_getActiveElementRevealDelta")}
			${extractAddedMethod(patch, "_disposeFocusPinnedItem")}
			${extractAddedMethod(patch, "_releaseInactiveFocusPinnedItem")}
			${extractAddedMethod(patch, "_restoreFocusPinnedItem")}
		}`
	],
	["FocusPinHarness"]
);

type TouchFocusHarness = {
	scrollTop: number;
	touchFocusScrollAnchor:
		{ readonly element: object; scrollTop: number } | undefined;
	setCalls: number[];
	revealCalls: Array<{ element: object; container: object }>;
	_restoreTouchFocusScrollAnchor(): void;
};

const { TouchFocusHarness, setPatchActiveElement } = evaluatePatchSnippets<{
	TouchFocusHarness: new (
		anchor: TouchFocusHarness["touchFocusScrollAnchor"],
		contained?: boolean
	) => TouchFocusHarness;
	setPatchActiveElement: (element: object | null) => void;
}>(
	[
		`let patchActiveElement = null;
		function getActiveElement() { return patchActiveElement; }
		function setPatchActiveElement(element) { patchActiveElement = element; }
		class TouchFocusHarness {
			setCalls = [];
			revealCalls = [];
			scrollTop = 999;
			domNode = {};

			constructor(anchor, contained = true) {
				this.touchFocusScrollAnchor = anchor;
				this.rowsContainer = { contains: element => contained && element === anchor?.element };
			}

			setScrollTop(scrollTop) {
				this.setCalls.push(scrollTop);
				this.scrollTop = scrollTop;
			}

			_scrollToActiveElement(element, container) {
				this.revealCalls.push({ element, container });
			}

			${extractAddedMethod(patch, "_restoreTouchFocusScrollAnchor")}
		}`
	],
	["TouchFocusHarness", "setPatchActiveElement"]
);

function item(containing?: unknown): Item {
	return {
		row: {
			domNode: {
				contains(active) {
					return active === containing;
				}
			}
		}
	};
}

describe("focused virtual-list row lifetime", () => {
	test("browser focus scrolling reveals only the part outside the viewport", () => {
		const harness = new FocusPinHarness([], undefined);

		// Opening an Android keyboard can scroll the outer DOM element even when the
		// focused settings control is already fully visible. That event must be a no-op.
		expect(harness._getActiveElementRevealDelta(120, 160, 100, 500)).toBe(0);
		expect(harness._getActiveElementRevealDelta(90, 130, 100, 500)).toBe(-10);
		expect(harness._getActiveElementRevealDelta(480, 515, 100, 500)).toBe(15);
		expect(harness._getActiveElementRevealDelta(90, 515, 100, 500)).toBe(-10);

		expect(added).not.toContain("heightShrank");
		expect(added).not.toContain("scrollValue");
		expect(patch).toContain("element.scrollTop = 0");
		expect(added).toContain("element.contains(activeElement)");
		expect(
			readRepoFile(
				"packages/ide/upstream/lib/vscode/src/vs/workbench/contrib/preferences/browser/settingsTree.ts"
			)
		).toContain("scrollToActiveElement: true");
	});

	test("touch focus stays anchored through a WebView resize until the user scrolls", () => {
		const element = {};
		const anchor = { element, scrollTop: 123 };
		const harness = new TouchFocusHarness(anchor);
		setPatchActiveElement(element);

		harness._restoreTouchFocusScrollAnchor();

		expect(harness.setCalls).toEqual([123]);
		expect(harness.revealCalls).toEqual([
			{ element, container: expect.any(Object) as object }
		]);
		expect(harness.touchFocusScrollAnchor?.scrollTop).toBe(123);
		expect(added).toContain("e.pointerType === 'touch'");
		expect(added).toContain("isEditableElement(target)");
		expect(added).toContain("ResizeObserver");
		expect(added).toContain("this.touchFocusScrollAnchor = undefined");
	});

	test("stale touch anchors cannot pull focus back to another or recycled row", () => {
		const element = {};
		setPatchActiveElement({});
		const movedFocus = new TouchFocusHarness({ element, scrollTop: 123 });
		movedFocus._restoreTouchFocusScrollAnchor();
		expect(movedFocus.touchFocusScrollAnchor).toBeUndefined();
		expect(movedFocus.setCalls).toEqual([]);

		setPatchActiveElement(element);
		const recycledRow = new TouchFocusHarness(
			{ element, scrollTop: 123 },
			false
		);
		recycledRow._restoreTouchFocusScrollAnchor();
		expect(recycledRow.touchFocusScrollAnchor).toBeUndefined();
		expect(recycledRow.setCalls).toEqual([]);
	});

	test("a pinned row re-enters without replacing its focused contents", () => {
		const pinned = item();
		const harness = new FocusPinHarness([item(), pinned], pinned);

		expect(harness._restoreFocusPinnedItem(1)).toBe(true);
		expect(harness.updated).toEqual([{ item: pinned, index: 1 }]);
		expect(harness.removed).toEqual([]);
		expect(harness.focusPinnedItem).toBeUndefined();
		expect(
			added.match(/if \(!this\._restoreFocusPinnedItem\(i\)\)/g)
		).toHaveLength(2);
		expect(added).toContain("if (this._restoreFocusPinnedItem(i)) {");
	});

	test("the pin follows item identity when a splice moves its index", () => {
		const pinned = item();
		const harness = new FocusPinHarness([item(), pinned], pinned);

		harness.items.unshift(item());

		expect(harness._restoreFocusPinnedItem(2)).toBe(true);
		expect(harness.updated).toEqual([{ item: pinned, index: 2 }]);
		expect(harness.removed).toEqual([]);
	});

	test("an off-range row remains pinned only while it owns focus", () => {
		const active = {};
		const pinned = item(active);
		const harness = new FocusPinHarness([pinned, item()], pinned);

		harness._releaseInactiveFocusPinnedItem({ start: 1, end: 2 }, active, true);
		expect(harness.focusPinnedItem).toBe(pinned);
		expect(harness.removed).toEqual([]);

		harness._releaseInactiveFocusPinnedItem({ start: 1, end: 2 }, {}, true);
		expect(harness.focusPinnedItem).toBeUndefined();
		expect(harness.removed).toEqual([{ index: 0, onScroll: true }]);
	});

	test("only deleting the pinned item disposes its row", () => {
		const pinned = item();
		const harness = new FocusPinHarness([item(), pinned], pinned);

		harness._disposeFocusPinnedItem();

		expect(harness.removed).toEqual([{ index: 1, onScroll: undefined }]);
		expect(harness.focusPinnedItem).toBeUndefined();
		expect(added).toContain(
			"focusPinnedIndex >= start && focusPinnedIndex < start + deleteCount"
		);
	});
});
