import { describe, expect, test } from "vitest";

import {
	addedLines,
	evaluatePatchSnippets,
	extractAddedFunction,
	extractAddedMethod,
	readRepoFile
} from "./support/patchSource.ts";

const patch = readRepoFile("packages/ide/patches/touch.diff");

interface Point {
	x: number;
	y: number;
}

interface Geometry {
	getTouchHandleGrabOffset: (pointer: Point, selectionPoint: Point) => Point;
	getTouchHandleSelectionPoint: (pointer: Point, grabOffset: Point) => Point;
	getTouchRangeHandleLayout: (
		selectionEmpty: boolean,
		movingBeforeAnchor: boolean
	) => {
		activeKind: "start" | "end";
		fixedKind: "start" | "end";
		showFixed: boolean;
	};
}

function loadGeometry(source: string): Geometry {
	return evaluatePatchSnippets<Geometry>(
		[
			extractAddedFunction(source, "getTouchHandleGrabOffset"),
			extractAddedFunction(source, "getTouchHandleSelectionPoint"),
			extractAddedFunction(source, "getTouchRangeHandleLayout")
		],
		[
			"getTouchHandleGrabOffset",
			"getTouchHandleSelectionPoint",
			"getTouchRangeHandleLayout"
		]
	);
}

function loadScheduler(source: string): {
	Harness: new () => {
		updates: number;
		_scheduleTouchHandleUpdate(): void;
	};
	scheduled: Array<() => void>;
} {
	return evaluatePatchSnippets(
		[
			`const scheduled: Array<() => void> = [];
			const dom = {
				getWindow() {
					return {
						requestAnimationFrame(callback: () => void) {
							scheduled.push(callback);
							return scheduled.length;
						}
					};
				}
			};`,
			`class Harness {
				_handleUpdateFrame: number | undefined;
				updates = 0;
				viewHelper = { viewDomNode: {} };
				_updateTouchHandles() { this.updates++; }
				${extractAddedMethod(source, "_scheduleTouchHandleUpdate")}
			}`
		],
		["Harness", "scheduled"]
	);
}

function extractAddedOverrideMethod(source: string, name: string): string {
	const added = addedLines(source);
	const start = added.indexOf(`public override ${name}(`);
	if (start < 0) throw new Error(`Could not find added override ${name}`);

	let depth = 0;
	for (let i = added.indexOf("{", start); i < added.length; i++) {
		if (added[i] === "{") depth++;
		else if (added[i] === "}") {
			depth--;
			if (depth === 0) {
				return added.slice(start, i + 1).replace(/^public override /, "");
			}
		}
	}

	throw new Error(`Could not parse added override ${name}`);
}

describe("touch editor selection handles", () => {
	test("preserves the finger-to-tip offset instead of jumping on first move", () => {
		const geometry = loadGeometry(patch);
		const grab = geometry.getTouchHandleGrabOffset(
			{ x: 149, y: 338 },
			{ x: 140, y: 320 }
		);

		expect(grab).toEqual({ x: 9, y: 18 });
		expect(
			geometry.getTouchHandleSelectionPoint({ x: 149, y: 338 }, grab)
		).toEqual({ x: 140, y: 320 });
		expect(
			geometry.getTouchHandleSelectionPoint({ x: 181, y: 379 }, grab)
		).toEqual({ x: 172, y: 361 });
	});

	test("the geometry check rejects the old plus-offset failure mode", () => {
		const mutant = patch.replace(
			"x: pointer.x - grabOffset.x, y: pointer.y - grabOffset.y",
			"x: pointer.x + grabOffset.x, y: pointer.y + grabOffset.y"
		);
		expect(mutant).not.toBe(patch);
		const geometry = loadGeometry(mutant);

		expect(
			geometry.getTouchHandleSelectionPoint({ x: 149, y: 338 }, { x: 9, y: 18 })
		).not.toEqual({ x: 140, y: 320 });
	});

	test("the captured handle stays active across crossing and collapse", () => {
		const { getTouchRangeHandleLayout } = loadGeometry(patch);

		expect(getTouchRangeHandleLayout(false, true)).toEqual({
			activeKind: "start",
			fixedKind: "end",
			showFixed: true
		});
		expect(getTouchRangeHandleLayout(false, false)).toEqual({
			activeKind: "end",
			fixedKind: "start",
			showFixed: true
		});
		expect(getTouchRangeHandleLayout(true, true)).toEqual({
			activeKind: "start",
			fixedKind: "end",
			showFixed: false
		});
	});

	test("collapse visibility is mutation-checked", () => {
		const mutant = patch.replace(
			"showFixed: !selectionEmpty",
			"showFixed: true"
		);
		expect(mutant).not.toBe(patch);
		expect(
			loadGeometry(mutant).getTouchRangeHandleLayout(true, true).showFixed
		).toBe(true);
	});

	test("drag cleanup releases capture, stops auto-scroll, and schedules repaint", () => {
		const stop = extractAddedMethod(patch, "_stopHandleDrag");
		const { Harness } = evaluatePatchSnippets<{
			Harness: new () => {
				_activeHandleDrag: unknown;
				stops: number;
				updates: number;
				_stopHandleDrag(): void;
			};
		}>(
			[
				`class Harness {
					_activeHandleDrag: any = null;
					stops = 0;
					updates = 0;
					_stopHandleAutoScroll() { this.stops++; }
					_scheduleTouchHandleUpdate() { this.updates++; }
					${stop}
				}`
			],
			["Harness"]
		);
		const harness = new Harness();
		let captured = true;
		let releases = 0;
		harness._activeHandleDrag = {
			pointerId: 7,
			handle: {
				hasPointerCapture: (id: number) => id === 7 && captured,
				releasePointerCapture: () => {
					captured = false;
					releases++;
				}
			}
		};

		harness._stopHandleDrag();

		expect(harness._activeHandleDrag).toBeNull();
		expect(captured).toBe(false);
		expect(releases).toBe(1);
		expect(harness.stops).toBe(1);
		expect(harness.updates).toBe(1);
	});

	test("menu suppression immediately hides every handle", () => {
		const { Harness } = evaluatePatchSnippets<{
			Harness: new () => {
				_handlesSuppressed: boolean;
				_caretHandle: { style: { display: string } };
				_startHandle: { style: { display: string } };
				_endHandle: { style: { display: string } };
				_suppressTouchHandles(): void;
			};
		}>(
			[
				`class Harness {
					_handlesSuppressed = false;
					_caretHandle = { style: { display: 'block' } };
					_startHandle = { style: { display: 'block' } };
					_endHandle = { style: { display: 'block' } };
					${extractAddedMethod(patch, "_hideTouchHandles")}
					${extractAddedMethod(patch, "_suppressTouchHandles")}
				}`
			],
			["Harness"]
		);
		const harness = new Harness();

		harness._suppressTouchHandles();

		expect(harness._handlesSuppressed).toBe(true);
		expect(harness._caretHandle.style.display).toBe("none");
		expect(harness._startHandle.style.display).toBe("none");
		expect(harness._endHandle.style.display).toBe("none");
	});

	test("unfocused and menu-owned editors cannot repaint handles", () => {
		const { Harness } = evaluatePatchSnippets<{
			Harness: new () => {
				_editorFocused: boolean;
				_handlesSuppressed: boolean;
				hides: number;
				_updateTouchHandles(): void;
			};
		}>(
			[
				`const Position = { isBeforeOrEqual: () => true };
				class Harness {
					_lastPointerType = 'touch';
					_editorFocused = false;
					_handlesSuppressed = false;
					_primarySelection = {};
					_activeHandleDrag = null;
					hides = 0;
					_hideTouchHandles() { this.hides++; }
					_setRangeHandleKind() {}
					_positionHandle() {}
					${extractAddedMethod(patch, "_updateTouchHandles")}
				}`
			],
			["Harness"]
		);
		const harness = new Harness();

		harness._updateTouchHandles();
		harness._editorFocused = true;
		harness._handlesSuppressed = true;
		harness._updateTouchHandles();

		expect(harness.hides).toBe(2);
	});

	test("cursor and scroll bursts coalesce into one scheduled geometry update", () => {
		const { Harness, scheduled } = loadScheduler(patch);
		const harness = new Harness();

		harness._scheduleTouchHandleUpdate();
		harness._scheduleTouchHandleUpdate();
		harness._scheduleTouchHandleUpdate();

		expect(scheduled).toHaveLength(1);
		scheduled[0]!();
		expect(harness.updates).toBe(1);
	});

	test("every upstream cursor-geometry invalidation schedules a handle repaint", () => {
		const methods = [
			"onDecorationsChanged",
			"onFlushed",
			"onLinesChanged",
			"onLinesDeleted",
			"onLinesInserted",
			"onZonesChanged"
		].map((name) => extractAddedOverrideMethod(patch, name));
		const { Harness } = evaluatePatchSnippets<{
			Harness: new () => Record<string, (event: object) => boolean> & {
				updates: number;
			};
		}>(
			[
				`class Harness {
					updates = 0;
					_scheduleTouchHandleUpdate() { this.updates++; }
					${methods.join("\n")}
				}`
			],
			["Harness"]
		);
		const harness = new Harness();

		for (const name of [
			"onDecorationsChanged",
			"onFlushed",
			"onLinesChanged",
			"onLinesDeleted",
			"onLinesInserted",
			"onZonesChanged"
		]) {
			expect(harness[name]!({})).toBe(false);
		}

		expect(harness.updates).toBe(6);
	});

	test("token changes repaint only when they can move a selected endpoint", () => {
		const { Harness } = evaluatePatchSnippets<{
			Harness: new () => {
				updates: number;
				onTokensChanged(event: {
					ranges: Array<{ fromLineNumber: number; toLineNumber: number }>;
				}): boolean;
			};
		}>(
			[
				`class Harness {
					updates = 0;
					_primarySelection = { startLineNumber: 10, endLineNumber: 12 };
					_scheduleTouchHandleUpdate() { this.updates++; }
					${extractAddedOverrideMethod(patch, "onTokensChanged")}
				}`
			],
			["Harness"]
		);
		const harness = new Harness();

		expect(
			harness.onTokensChanged({
				ranges: [
					{ fromLineNumber: 1, toLineNumber: 9 },
					{ fromLineNumber: 13, toLineNumber: 20 }
				]
			})
		).toBe(false);
		expect(harness.updates).toBe(0);

		harness.onTokensChanged({
			ranges: [{ fromLineNumber: 8, toLineNumber: 10 }]
		});
		harness.onTokensChanged({
			ranges: [{ fromLineNumber: 12, toLineNumber: 14 }]
		});

		expect(harness.updates).toBe(2);
	});

	test("the coalescing guard is mutation-checked", () => {
		const mutant = patch.replace(
			"if (this._handleUpdateFrame !== undefined) {",
			"if (false) {"
		);
		expect(mutant).not.toBe(patch);
		const { Harness, scheduled } = loadScheduler(mutant);
		const harness = new Harness();

		harness._scheduleTouchHandleUpdate();
		harness._scheduleTouchHandleUpdate();

		expect(scheduled).toHaveLength(2);
	});

	// The start handle offsets its body one full width left of its tip, so at
	// column 1 the body falls outside .lines-content and the overflow guard hides
	// it. It is mirrored rather than clamped so the tip stays on the selection edge.
	function loadHandlePlacement() {
		return evaluatePatchSnippets<{
			Harness: new () => {
				_positionHandle(handle: FakeHandle, position: unknown): void;
				_getHandleSelectionClientPoint(
					handle: FakeHandle,
					kind: string,
					position: unknown
				): { x: number; y: number };
				left: number;
			};
		}>(
			[
				`class Harness {
					left = 0;
					_caretHandle = { id: 'caret' };
					viewHelper = { visibleRangeForPosition: () => ({ left: this.left, outsideRenderedLine: false }) };
					_context = { viewLayout: {
						getLineHeightForLineNumber: () => 20,
						getVerticalOffsetForLineNumber: () => 100,
						getLinesViewportData: () => ({ bigNumbersDelta: 0 })
					} };
					_getHandleKind(handle) {
						if (handle === this._caretHandle) return 'caret';
						return handle.classList.contains('composery-touch-range-handle-start') ? 'start' : 'end';
					}
					${extractAddedMethod(patch, "_positionHandle")}
					${extractAddedMethod(patch, "_getHandleSelectionClientPoint")}
				}`,
				`const TOUCH_HANDLE_WIDTH = 22;`,
				`const TOUCH_HANDLE_FLIPPED_CLASS = 'composery-touch-range-handle-flipped';`
			],
			["Harness"]
		);
	}

	interface FakeHandle {
		classList: {
			contains(name: string): boolean;
			toggle(name: string, force: boolean): void;
		};
		style: Record<string, string>;
		getBoundingClientRect(): { left: number; right: number; top: number };
	}

	function fakeHandle(kind: "start" | "end"): FakeHandle {
		const classes = new Set([`composery-touch-range-handle-${kind}`]);
		return {
			classList: {
				contains: (name: string) => classes.has(name),
				toggle: (name: string, force: boolean) => {
					if (force) classes.add(name);
					else classes.delete(name);
				}
			},
			style: {},
			getBoundingClientRect: () => ({ left: 200, right: 222, top: 50 })
		};
	}

	const FLIPPED = "composery-touch-range-handle-flipped";

	test("the start handle mirrors at column 1 so it is not clipped away", () => {
		const { Harness } = loadHandlePlacement();
		const harness = new Harness();
		const handle = fakeHandle("start");

		harness.left = 0;
		harness._positionHandle(handle, { lineNumber: 1, column: 1 });

		expect(handle.classList.contains(FLIPPED)).toBe(true);
	});

	test("the start handle keeps its normal shape once there is room", () => {
		const { Harness } = loadHandlePlacement();
		const harness = new Harness();
		const handle = fakeHandle("start");

		harness.left = 22;
		harness._positionHandle(handle, { lineNumber: 1, column: 4 });

		expect(handle.classList.contains(FLIPPED)).toBe(false);
	});

	test("the end handle never mirrors - its body already opens rightwards", () => {
		const { Harness } = loadHandlePlacement();
		const harness = new Harness();
		const handle = fakeHandle("end");

		harness.left = 0;
		harness._positionHandle(handle, { lineNumber: 1, column: 1 });

		// Mirroring here would push the body left and cause the very clip we fix.
		expect(handle.classList.contains(FLIPPED)).toBe(false);
	});

	test("mirroring moves the drag anchor to the tip's new corner", () => {
		const { Harness } = loadHandlePlacement();
		const harness = new Harness();
		const handle = fakeHandle("start");
		const position = { lineNumber: 1, column: 1 };

		harness.left = 200;
		harness._positionHandle(handle, position);
		const upright = harness._getHandleSelectionClientPoint(
			handle,
			"start",
			position
		);

		harness.left = 0;
		harness._positionHandle(handle, position);
		const mirrored = harness._getHandleSelectionClientPoint(
			handle,
			"start",
			position
		);

		// Upright, the tip is the box's right edge; mirrored, it is the left edge.
		expect(upright.x).toBe(222);
		expect(mirrored.x).toBe(200);
	});

	test("all external interaction-loss paths stop the active drag", () => {
		for (const marker of [
			"'lostpointercapture'",
			"targetWindow, 'blur'",
			"'visibilitychange'",
			"public override onFocusChanged"
		]) {
			expect(patch).toContain(marker);
			expect(patch.replace(marker, "removed-cleanup-path")).not.toContain(
				marker
			);
		}
	});
});
