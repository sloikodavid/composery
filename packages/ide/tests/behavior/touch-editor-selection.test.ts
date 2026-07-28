// What the editor still owns of touch selection now that the grips themselves are shared
// (touch-selection-handles.test.ts drives those): where its selection edges are in client
// coordinates, which end a drag anchors, and which end the finger holds after crossing it.
// The code is extracted from the patch it ships in, so these exercise the shipped source.
import { describe, expect, test } from "vitest";

import { readRepoFile } from "../../../../tests/support/repo.ts";
import {
	evaluatePatchSnippets,
	extractAddedMethod,
	extractAddedOverrideMethod
} from "../support/patch.ts";

const patch = readRepoFile("packages/ide/patches/touch.diff");

interface Position {
	lineNumber: number;
	column: number;
}

interface Harness {
	_lastPointerType: string;
	_editorFocused: boolean;
	_primarySelection: unknown;
	_primaryModelSelection: unknown;
	_touchDragAnchor: Position | null;
	updates: number;
	focuses: number;
	selections: Array<[Position, Position]>;
	targetAt: (x: number, y: number) => { position: Position } | null;
	outsideRenderedLine: boolean;
	_getTouchSelectionEdges(): Record<string, unknown> | null;
	_startTouchSelectionDrag(kind: string): void;
	_dragTouchSelectionTo(x: number, y: number): string | undefined;
	handleEvents(events: unknown[]): void;
}

// The stand-ins are the editor's own shapes: a selection knows its ends and whether it is
// empty, the layout answers in content coordinates, and the lines' rect carries the scroll.
const LINES_RECT = { left: 30, top: 200 };
const LINE_HEIGHT = 19;
const BIG_NUMBERS_DELTA = 1000;

function selection(start: Position, end: Position): unknown {
	return {
		start,
		end,
		isEmpty: () =>
			start.lineNumber === end.lineNumber && start.column === end.column,
		getPosition: () => end,
		getSelectionStart: () => start,
		getStartPosition: () => start,
		getEndPosition: () => end
	};
}

function load(source: string): Harness {
	const { Harness } = evaluatePatchSnippets<{ Harness: new () => Harness }>(
		[
			`const Position = {
				// Upstream's ordering, restated: line first, then column.
				isBeforeOrEqual: (a, b) => a.lineNumber < b.lineNumber || (a.lineNumber === b.lineNumber && a.column <= b.column)
			};
			const Selection = { fromPositions: (a, b) => [a, b ?? a] };`,
			`class Harness {
				_lastPointerType = 'touch';
				_editorFocused = true;
				_primarySelection = null;
				_primaryModelSelection = null;
				_touchDragAnchor = null;
				updates = 0;
				focuses = 0;
				selections = [];
				outsideRenderedLine = false;
				targetAt = () => null;
				_touchHandles = { scheduleUpdate: () => { this.updates++; } };
				viewHelper = {
					focusTextArea: () => { this.focuses++; },
					linesContentDomNode: { getBoundingClientRect: () => (${JSON.stringify(LINES_RECT)}) },
					visibleRangeForPosition: (lineNumber, column) => ({ left: column * 7, outsideRenderedLine: this.outsideRenderedLine })
				};
				_context = {
					viewLayout: {
						getLineHeightForLineNumber: () => ${LINE_HEIGHT},
						getVerticalOffsetForLineNumber: (lineNumber) => ${BIG_NUMBERS_DELTA} + lineNumber * ${LINE_HEIGHT},
						getLinesViewportData: () => ({ bigNumbersDelta: ${BIG_NUMBERS_DELTA} })
					},
					viewModel: { coordinatesConverter: { convertViewPositionToModelPosition: (p) => p } }
				};
				viewController = { setSelection: (s) => { this.selections.push(s); } };
				getTargetAtClientPoint(x, y) { return this.targetAt(x, y); }
				${extractAddedOverrideMethod(source, "handleEvents").replace("super.handleEvents(events);", "")}
				${extractAddedMethod(source, "_getTouchSelectionEdges")}
				${extractAddedMethod(source, "_touchSelectionEdgeAt")}
				${extractAddedMethod(source, "_startTouchSelectionDrag")}
				${extractAddedMethod(source, "_dragTouchSelectionTo")}
			}`
		],
		["Harness"]
	);
	return new Harness();
}

const at = (lineNumber: number, column: number): Position => ({
	lineNumber,
	column
});

describe("touch editor selection", () => {
	test("only a focused editor under a finger carries grips", () => {
		const harness = load(patch);
		harness._primarySelection = selection(at(3, 2), at(3, 6));

		expect(harness._getTouchSelectionEdges()).not.toBeNull();

		harness._lastPointerType = "mouse";
		expect(harness._getTouchSelectionEdges()).toBeNull();

		harness._lastPointerType = "touch";
		harness._editorFocused = false;
		expect(harness._getTouchSelectionEdges()).toBeNull();
	});

	test("a collapsed selection is a caret, a range is two ends", () => {
		const harness = load(patch);

		harness._primarySelection = selection(at(3, 4), at(3, 4));
		expect(Object.keys(harness._getTouchSelectionEdges() ?? {})).toEqual([
			"caret"
		]);

		harness._primarySelection = selection(at(3, 2), at(4, 6));
		expect(Object.keys(harness._getTouchSelectionEdges() ?? {})).toEqual([
			"start",
			"end"
		]);
	});

	test("an edge is reported where it is on screen, and not at all off it", () => {
		const harness = load(patch);
		harness._primarySelection = selection(at(3, 2), at(3, 2));

		expect(harness._getTouchSelectionEdges()?.caret).toEqual({
			// The lines' own rect carries the scroll, so the edge is the content offset
			// (minus the big-numbers delta) laid onto it.
			x: LINES_RECT.left + 2 * 7,
			y: LINES_RECT.top + 3 * LINE_HEIGHT + LINE_HEIGHT,
			height: LINE_HEIGHT
		});

		harness.outsideRenderedLine = true;
		expect(harness._getTouchSelectionEdges()?.caret).toBeUndefined();
	});

	test("a drag pins the far end and focuses the editor", () => {
		const harness = load(patch);
		harness._primaryModelSelection = selection(at(2, 1), at(5, 9));

		harness._startTouchSelectionDrag("start");
		expect(harness._touchDragAnchor).toEqual(at(5, 9));

		harness._startTouchSelectionDrag("end");
		expect(harness._touchDragAnchor).toEqual(at(2, 1));

		// A caret has no far end to pin - it drags alone.
		harness._startTouchSelectionDrag("caret");
		expect(harness._touchDragAnchor).toBeNull();
		expect(harness.focuses).toBe(3);
	});

	test("dragging past the anchor hands the finger the other end", () => {
		const harness = load(patch);
		harness._primaryModelSelection = selection(at(2, 1), at(5, 9));
		harness._startTouchSelectionDrag("end");

		harness.targetAt = () => ({ position: at(7, 3) });
		expect(harness._dragTouchSelectionTo(120, 400)).toBe("end");
		expect(harness.selections.at(-1)).toEqual([at(2, 1), at(7, 3)]);

		harness.targetAt = () => ({ position: at(1, 2) });
		expect(harness._dragTouchSelectionTo(40, 210)).toBe("start");
		expect(harness.selections.at(-1)).toEqual([at(2, 1), at(1, 2)]);
	});

	test("a caret drag stays a caret, and a drag off the lines changes nothing", () => {
		const harness = load(patch);
		harness._startTouchSelectionDrag("caret");

		harness.targetAt = () => ({ position: at(4, 2) });
		expect(harness._dragTouchSelectionTo(60, 300)).toBe("caret");
		expect(harness.selections.at(-1)).toEqual([at(4, 2), at(4, 2)]);

		harness.targetAt = () => null;
		expect(harness._dragTouchSelectionTo(0, 0)).toBeUndefined();
		expect(harness.selections).toHaveLength(1);
	});

	test("any view event batch the editor handles schedules a repaint", () => {
		const harness = load(patch);
		harness.handleEvents([]);
		harness.handleEvents([{}, {}]);
		expect(harness.updates).toBe(2);
	});
});
