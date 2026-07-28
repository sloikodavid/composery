// Terminal text selection by touch, driven against a real DOM and a stand-in xterm whose
// selection model answers exactly as xterm's does (inclusive start, exclusive end, a
// length that wraps across rows). The contribution, the shared grips and the cell geometry
// are all evaluated as shipped, so what is exercised is the arithmetic that decides which
// cells a finger selected - the part no amount of reading confirms.
import { JSDOM } from "jsdom";
import ts from "typescript";
import { afterEach, describe, expect, test } from "vitest";

import { readRepoFile } from "../../../../tests/support/repo.ts";

const OVERLAY = "packages/ide/overlay/lib/vscode/src/vs";
const HANDLES = `${OVERLAY}/base/browser/touchSelectionHandles.ts`;
const CELLS = `${OVERLAY}/workbench/contrib/terminal/browser/xtermCell.ts`;
const CONTRIBUTION = `${OVERLAY}/workbench/contrib/terminalContrib/touchSelection/browser/terminal.touchSelection.contribution.ts`;

// The gesture event names are upstream's, so they are read from upstream rather than
// copied: a rename there must break this test, not slip past it.
function gestureEventType(name: string): string {
	const touch = readRepoFile(
		"packages/ide/upstream/lib/vscode/src/vs/base/browser/touch.ts"
	);
	const value = new RegExp(`export const ${name} = '([^']+)'`).exec(touch)?.[1];
	if (!value) throw new Error(`No gesture event type ${name} upstream`);
	return value;
}

const TAP = gestureEventType("Tap");
const START = gestureEventType("Start");

function compile(path: string): string {
	const source = readRepoFile(path)
		.replace(/^import .*$/gm, "")
		.replace(/^export /gm, "");
	return ts.transpileModule(source, {
		compilerOptions: { target: ts.ScriptTarget.ES2022 }
	}).outputText;
}

// The VS Code helpers the modules import, restated as what they are.
const PRELUDE = `
const dom = {
	getWindow: () => window,
	addDisposableListener(target, type, listener, options) {
		target.addEventListener(type, listener, options);
		return { dispose: () => target.removeEventListener(type, listener, options) };
	},
	EventType: { CONTEXT_MENU: 'contextmenu' }
};
class Disposable {
	constructor() { this._composeryStore = []; }
	_register(disposable) { this._composeryStore.push(disposable); return disposable; }
	dispose() { for (const disposable of this._composeryStore) disposable.dispose(); }
}
const TouchEventType = { Tap: ${JSON.stringify(TAP)}, Start: ${JSON.stringify(START)} };
let isTouchDevice = true;
const isTouch = () => isTouchDevice;
let registered;
const registerTerminalContribution = (id, ctor) => { registered = ctor; };
`;

const CELL = { width: 10, height: 20 };
const GRID = { left: 100, top: 50, cols: 80, rows: 24 };
// The row the stand-in terminal holds text on: clear of the edge zones, so a drag across
// the grid is a drag rather than an auto-scroll.
const TEXT_ROW = 5;
const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));
const frames = () => sleep(80);

interface Point {
	x: number;
	y: number;
}

const doms: JSDOM[] = [];
afterEach(async () => {
	const windows = doms.splice(0).map((dom) => dom.window);
	for (const window of windows) window.requestAnimationFrame = () => 0;
	await sleep(40);
	for (const window of windows) window.close();
});

/** A cell's client coordinates: the middle of it, which is where a finger lands. */
function at(column: number, row: number): Point {
	return {
		x: GRID.left + column * CELL.width + CELL.width / 2,
		y: GRID.top + row * CELL.height + CELL.height / 2
	};
}

function start({ touch = true, text = "make it build" } = {}) {
	const dom = new JSDOM(
		`<!doctype html><html><body><div class="monaco-workbench"><div class="pane">` +
			`<div class="xterm"><div class="xterm-viewport"></div><div class="xterm-screen"><div class="row"></div></div></div>` +
			`</div></div></body></html>`,
		{ runScripts: "dangerously", pretendToBeVisual: true }
	);
	doms.push(dom);
	const window = dom.window;
	const query = (selector: string) =>
		window.document.querySelector(selector) as HTMLElement;
	const workbench = query(".monaco-workbench");
	const pane = query(".pane");
	const element = query(".xterm");
	const screen = query(".xterm-screen");
	const row = query(".row");

	const box =
		(left: number, top: number, right: number, bottom: number) => () => ({
			left,
			top,
			right,
			bottom,
			width: right - left,
			height: bottom - top,
			x: left,
			y: top,
			toJSON: () => ({ left, top })
		});
	workbench.getBoundingClientRect = box(0, 0, 1200, 900);
	pane.getBoundingClientRect = box(GRID.left, GRID.top, 900, 530);
	screen.getBoundingClientRect = box(
		GRID.left,
		GRID.top,
		GRID.left + GRID.cols * CELL.width,
		GRID.top + GRID.rows * CELL.height
	);
	window.HTMLElement.prototype.setPointerCapture = function () {
		(this as HTMLElement & { captured?: boolean }).captured = true;
	};
	window.HTMLElement.prototype.releasePointerCapture = function () {
		(this as HTMLElement & { captured?: boolean }).captured = false;
	};
	window.HTMLElement.prototype.hasPointerCapture = function () {
		return !!(this as HTMLElement & { captured?: boolean }).captured;
	};

	// The stand-in terminal. Its selection model is xterm's: a start cell, a length that
	// wraps across rows, and an end that is exclusive in x.
	// Named channels rather than a string-keyed record: an index signature makes
	// every lookup `| undefined`, and typing the resize payload as `never[]` to
	// satisfy that hid what a resize listener is actually handed.
	const listeners: {
		selection: Array<() => void>;
		render: Array<() => void>;
		resize: Array<(size: { cols: number; rows: number }) => void>;
	} = {
		selection: [],
		render: [],
		resize: []
	};
	const xterm = {
		cols: GRID.cols,
		rows: GRID.rows,
		element,
		scrolled: 0,
		selection: undefined as { start: Point; end: Point } | undefined,
		buffer: { active: { viewportY: 0 } },
		_core: {
			_renderService: { dimensions: { css: { cell: CELL } } },
			_selectionService: {
				isCellInSelection(x: number, y: number): boolean {
					const selection = xterm.selection;
					if (!selection) return false;
					const { start, end } = selection;
					return (
						(y > start.y && y < end.y) ||
						(start.y === end.y && y === start.y && x >= start.x && x < end.x) ||
						(start.y < end.y && y === end.y && x < end.x) ||
						(start.y < end.y && y === start.y && x >= start.x)
					);
				},
				// xterm selects the word under the point, and leaves the model untouched
				// where there is none.
				rightClickSelect(event: MouseEvent): void {
					const column = Math.floor((event.clientX - GRID.left) / CELL.width);
					const rowIndex = Math.floor((event.clientY - GRID.top) / CELL.height);
					const line = rowIndex === TEXT_ROW ? text : "";
					if (!line[column] || line[column] === " ") return;
					let from = column;
					let to = column;
					while (from > 0 && line[from - 1] && line[from - 1] !== " ") from--;
					while (line[to + 1] && line[to + 1] !== " ") to++;
					xterm.select(from, rowIndex, to - from + 1);
				}
			}
		},
		select(column: number, rowIndex: number, length: number): void {
			const total = column + length;
			xterm.selection = {
				start: { x: column, y: rowIndex },
				end: {
					x: total % GRID.cols,
					y: rowIndex + Math.floor(total / GRID.cols)
				}
			};
			for (const listener of listeners.selection) listener();
		},
		getSelectionPosition: () => xterm.selection,
		hasSelection: () => !!xterm.selection,
		clearSelection(): void {
			xterm.selection = undefined;
			for (const listener of listeners.selection) listener();
		},
		scrollLines(lines: number): void {
			xterm.scrolled += lines;
			xterm.buffer.active.viewportY += lines;
		},
		onSelectionChange(listener: () => void) {
			listeners.selection.push(listener);
			return { dispose: () => {} };
		},
		dropSelection(): void {
			// Something other than the user took it - a resize, a relayout, a refocus.
			if (xterm.selection) {
				xterm.selection = undefined;
				for (const listener of listeners.selection) listener();
			}
		},
		resizeRows(): void {
			// xterm clears the selection on a row-count change - and only then does it
			// announce one - before firing onResize.
			if (xterm.selection) {
				xterm.selection = undefined;
				for (const listener of listeners.selection) listener();
			}
			for (const listener of listeners.resize)
				listener({ cols: GRID.cols, rows: GRID.rows });
		},
		onResize(listener: (size: { cols: number; rows: number }) => void) {
			listeners.resize.push(listener);
			return { dispose: () => {} };
		},
		onRender(listener: () => void) {
			listeners.render.push(listener);
			return { dispose: () => {} };
		}
	};

	window.eval(
		`${PRELUDE}\n${compile(HANDLES)}\n${compile(CELLS)}\n${compile(CONTRIBUTION)}
		isTouchDevice = ${touch};
		globalThis.startContribution = (xterm) => {
			const contribution = new registered({});
			contribution.xtermOpen({ raw: xterm });
			return contribution;
		};`
	);
	const contribution = (
		window as unknown as {
			startContribution: (xterm: unknown) => { dispose(): void };
		}
	).startContribution(xterm);

	/** A long-press: what Gesture re-fires on the pressed element. */
	function hold(point: Point) {
		const event = new window.MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
			clientX: point.x,
			clientY: point.y
		});
		row.dispatchEvent(event);
		return event;
	}

	function gesture(type: string) {
		element.dispatchEvent(new window.Event(type));
	}

	function pointer(target: HTMLElement, type: string, point: Point) {
		const event = new window.MouseEvent(type, {
			bubbles: true,
			cancelable: true,
			clientX: point.x,
			clientY: point.y
		});
		Object.defineProperty(event, "pointerId", { value: 1 });
		Object.defineProperty(event, "pointerType", { value: "touch" });
		target.dispatchEvent(event);
	}

	const grips = () =>
		[
			...window.document.querySelectorAll(".composery-touch-caret-handle")
		].filter(
			(grip) => (grip as HTMLElement).style.display === "block"
		) as HTMLElement[];
	const grip = (kind: "start" | "end") =>
		grips().find((element) =>
			element.classList.contains(`composery-touch-range-handle-${kind}`)
		);

	const menuEvents: MouseEvent[] = [];
	pane.addEventListener("contextmenu", (event) =>
		menuEvents.push(event as MouseEvent)
	);

	return {
		window,
		xterm,
		contribution,
		listeners,
		hold,
		gesture,
		pointer,
		grips,
		grip,
		menuEvents
	};
}

describe("terminal touch selection", () => {
	test("a hold on a word selects it and keeps the pane's menu shut", () => {
		const { xterm, hold, menuEvents } = start();
		const event = hold(at(5, TEXT_ROW)); // inside "it"

		expect(xterm.selection).toEqual({
			start: { x: 5, y: TEXT_ROW },
			end: { x: 7, y: TEXT_ROW }
		});
		expect(event.defaultPrevented).toBe(true);
		expect(menuEvents).toHaveLength(0);
	});

	test("a hold on the selection is a request for the menu, not a new selection", () => {
		const { xterm, hold, menuEvents } = start();
		hold(at(5, TEXT_ROW));
		const selection = { ...xterm.selection };

		const event = hold(at(6, TEXT_ROW));
		expect(xterm.selection).toEqual(selection);
		expect(event.defaultPrevented).toBe(false);
		expect(menuEvents).toHaveLength(1);
	});

	test("a hold on blank space drops the selection and lets the menu open", () => {
		const { xterm, hold, menuEvents } = start();
		hold(at(5, TEXT_ROW));
		expect(xterm.selection).toBeTruthy();

		const event = hold(at(4, TEXT_ROW)); // the space between the words
		expect(xterm.selection).toBeUndefined();
		expect(event.defaultPrevented).toBe(false);
		expect(menuEvents).toHaveLength(1);
	});

	test("the grips land on the edges of the selected cells", async () => {
		const { hold, grip } = start();
		hold(at(5, TEXT_ROW));
		await frames();

		// "it" is columns 5-6: the range opens at the left edge of column 5 and closes at
		// the right edge of column 6, one row down from the row it sits on.
		expect(grip("start")?.style.transform).toBe(
			`translate(${GRID.left + 5 * CELL.width}px, ${GRID.top + (TEXT_ROW + 1) * CELL.height}px)`
		);
		expect(grip("end")?.style.transform).toBe(
			`translate(${GRID.left + 7 * CELL.width}px, ${GRID.top + (TEXT_ROW + 1) * CELL.height}px)`
		);
	});

	test("dragging the end grip takes in the cell under the finger", async () => {
		const { xterm, hold, pointer, grip } = start();
		hold(at(5, TEXT_ROW));
		await frames();
		const end = grip("end")!;

		pointer(end, "pointerdown", {
			x: GRID.left + 7 * CELL.width,
			y: GRID.top + (TEXT_ROW + 1) * CELL.height - CELL.height / 2
		});
		pointer(end, "pointermove", at(11, TEXT_ROW));

		expect(xterm.selection).toEqual({
			start: { x: 5, y: TEXT_ROW },
			end: { x: 12, y: TEXT_ROW }
		});
	});

	test("dragging the start grip past the anchor keeps the range on the other side", async () => {
		const { xterm, hold, pointer, grip } = start();
		hold(at(5, TEXT_ROW)); // "it": columns 5-6
		await frames();
		const startGrip = grip("start")!;

		pointer(startGrip, "pointerdown", {
			x: GRID.left + 5 * CELL.width,
			y: GRID.top + (TEXT_ROW + 1) * CELL.height - CELL.height / 2
		});
		pointer(startGrip, "pointermove", at(0, TEXT_ROW));
		expect(xterm.selection).toEqual({
			start: { x: 0, y: TEXT_ROW },
			end: { x: 7, y: TEXT_ROW }
		});

		// Past the far end: the finger now drags what has become the end of the range.
		pointer(startGrip, "pointermove", at(20, TEXT_ROW));
		expect(xterm.selection).toEqual({
			start: { x: 6, y: TEXT_ROW },
			end: { x: 21, y: TEXT_ROW }
		});
		await frames();
		expect(
			startGrip.classList.contains("composery-touch-range-handle-end")
		).toBe(true);
	});

	test("a drag held at the bottom edge scrolls the buffer by whole lines", async () => {
		const { xterm, hold, pointer, grip } = start();
		hold(at(5, TEXT_ROW));
		await frames();
		const end = grip("end")!;

		pointer(end, "pointerdown", {
			x: GRID.left + 7 * CELL.width,
			y: GRID.top + (TEXT_ROW + 1) * CELL.height - CELL.height / 2
		});
		pointer(end, "pointermove", {
			x: GRID.left + 20 * CELL.width,
			y: GRID.top + GRID.rows * CELL.height - 5
		});
		await frames();

		expect(xterm.scrolled).toBeGreaterThan(0);
		expect(Number.isInteger(xterm.scrolled)).toBe(true);
	});

	test("a tap is the end of the selection", () => {
		const { xterm, hold, gesture } = start();
		hold(at(5, TEXT_ROW));
		expect(xterm.selection).toBeTruthy();

		gesture(TAP);
		expect(xterm.selection).toBeUndefined();
	});

	test("a selection survives the resize its own menu causes", () => {
		const { xterm, hold } = start();
		hold(at(5, TEXT_ROW));
		const selection = { ...xterm.selection };
		expect(selection.start).toBeTruthy();

		// Opening the menu closes the keyboard and undocks the keybar, so the grid changes
		// height - and xterm drops the selection on any row-count change.
		xterm.resizeRows();

		expect(xterm.selection).toEqual(selection);
	});

	test("a selection the finger ended stays ended", () => {
		const { xterm, hold, gesture } = start();
		hold(at(5, TEXT_ROW));
		gesture(TAP);
		expect(xterm.selection).toBeUndefined();

		xterm.resizeRows();
		expect(xterm.selection).toBeUndefined();
	});

	test("the selection stays put while its own menu comes up", () => {
		const { xterm, hold } = start();
		hold(at(5, TEXT_ROW));
		const selection = { ...xterm.selection };

		// The hold that opens the menu, then everything the menu does to the page: the
		// keyboard closes, the keybar undocks, the panel relayouts - each of which can take
		// the selection with it, whatever the path.
		hold(at(5, TEXT_ROW));
		xterm.dropSelection();

		expect(xterm.selection).toEqual(selection);
	});

	test("nothing is wired up where there is no touch to wire it for", () => {
		const { xterm, hold, menuEvents } = start({ touch: false });
		const event = hold(at(5, TEXT_ROW));

		expect(xterm.selection).toBeUndefined();
		expect(event.defaultPrevented).toBe(false);
		expect(menuEvents).toHaveLength(1);
	});
});
