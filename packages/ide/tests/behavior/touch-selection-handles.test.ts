// The selection grips both hosts share (touchSelectionHandles.ts), driven against a real
// DOM. Everything here is geometry and pointer sequencing, which reading cannot verify:
// where a grip lands, which end it drags after crossing the other, and whether a finger
// parked at the edge keeps scrolling. The module is evaluated as shipped - only its two
// imports are restated below, as the VS Code helpers they are.
import { readFileSync } from "node:fs";

import { JSDOM } from "jsdom";
import ts from "typescript";
import { afterEach, describe, expect, test } from "vitest";

const HANDLES_TS = new URL(
	"../../overlay/lib/vscode/src/vs/base/browser/touchSelectionHandles.ts",
	import.meta.url
);

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
`;

export function compileOverlayModule(url: URL): string {
	const source = readFileSync(url, "utf8")
		.replace(/^import .*$/gm, "")
		.replace(/^export /gm, "");
	return ts.transpileModule(source, {
		compilerOptions: { target: ts.ScriptTarget.ES2022 }
	}).outputText;
}

const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Long enough for a scheduled frame and the frame it schedules in turn. */
const frames = () => sleep(80);

interface Edge {
	x: number;
	y: number;
	height: number;
}

// The pane the selection lives in. jsdom lays nothing out, so every rect a test
// depends on is stated here.
const VIEWPORT = { left: 100, top: 50, right: 500, bottom: 350 };

const doms: JSDOM[] = [];
afterEach(async () => {
	const windows = doms.splice(0).map((dom) => dom.window);
	for (const window of windows) window.requestAnimationFrame = () => 0;
	await sleep(40);
	for (const window of windows) window.close();
});

function rect(box: {
	left: number;
	top: number;
	right: number;
	bottom: number;
}) {
	return () => ({
		...box,
		width: box.right - box.left,
		height: box.bottom - box.top,
		x: box.left,
		y: box.top,
		toJSON: () => box
	});
}

function start() {
	const dom = new JSDOM(
		`<!doctype html><html><body><div class="monaco-workbench"><div class="pane"></div></div></body></html>`,
		{ runScripts: "dangerously", pretendToBeVisual: true }
	);
	doms.push(dom);
	const window = dom.window;
	const workbench = window.document.querySelector(
		".monaco-workbench"
	) as HTMLElement;
	const viewport = window.document.querySelector(".pane") as HTMLElement;
	// The workbench sits at the origin, so client coordinates and the coordinates the
	// handles are placed at coincide - a placement bug cannot hide behind an offset.
	workbench.getBoundingClientRect = rect({
		left: 0,
		top: 0,
		right: 1000,
		bottom: 800
	});
	viewport.getBoundingClientRect = rect(VIEWPORT);
	window.HTMLElement.prototype.setPointerCapture = function () {
		(this as HTMLElement & { captured?: boolean }).captured = true;
	};
	window.HTMLElement.prototype.releasePointerCapture = function () {
		(this as HTMLElement & { captured?: boolean }).captured = false;
	};
	window.HTMLElement.prototype.hasPointerCapture = function () {
		return !!(this as HTMLElement & { captured?: boolean }).captured;
	};

	const host = {
		viewport,
		edges: {
			start: { x: 150, y: 120, height: 20 },
			end: { x: 250, y: 120, height: 20 }
		} as Record<string, Edge | undefined> | null,
		getEdges: () => host.edges,
		started: [] as string[],
		points: [] as Array<[number, number]>,
		stopped: 0,
		scrolled: 0,
		kind: "end" as string | undefined,
		startDrag(kind: string) {
			host.started.push(kind);
		},
		dragTo(x: number, y: number) {
			host.points.push([x, y]);
			return host.kind;
		},
		stopDrag() {
			host.stopped++;
		},
		scrollBy(deltaY: number) {
			host.scrolled += deltaY;
		}
	};

	window.eval(`${PRELUDE}\n${compileOverlayModule(HANDLES_TS)}
		globalThis.makeHandles = (host) => new TouchSelectionHandles(host);`);
	const handles = (
		window as unknown as {
			makeHandles: (host: unknown) => {
				scheduleUpdate(): void;
				suppress(): void;
				reveal(): void;
				dispose(): void;
				readonly dragging: boolean;
			};
		}
	).makeHandles(host);

	const grips = () =>
		[
			...window.document.querySelectorAll(".composery-touch-caret-handle")
		] as HTMLElement[];
	const shown = () => grips().filter((grip) => grip.style.display === "block");

	function pointer(
		target: HTMLElement,
		type: string,
		x: number,
		y: number,
		id = 1
	) {
		const event = new window.MouseEvent(type, {
			bubbles: true,
			cancelable: true,
			clientX: x,
			clientY: y
		});
		Object.defineProperty(event, "pointerId", { value: id });
		Object.defineProperty(event, "pointerType", { value: "touch" });
		target.dispatchEvent(event);
		return event;
	}

	return { window, workbench, viewport, host, handles, grips, shown, pointer };
}

describe("touch selection handles", () => {
	test("a grip lands on the edge it marks, in the workbench", async () => {
		const { workbench, handles, host, shown } = start();
		handles.scheduleUpdate();
		await frames();

		const visible = shown();
		expect(visible).toHaveLength(2);
		for (const grip of visible) {
			expect(grip.parentElement).toBe(workbench);
		}
		const startGrip = visible.find((grip) =>
			grip.classList.contains("composery-touch-range-handle-start")
		);
		const endGrip = visible.find((grip) =>
			grip.classList.contains("composery-touch-range-handle-end")
		);
		expect(startGrip?.style.transform).toBe("translate(150px, 120px)");
		expect(endGrip?.style.transform).toBe("translate(250px, 120px)");
		expect(host.edges).toBeTruthy();
	});

	test("an edge scrolled out of its pane carries no grip", async () => {
		const { handles, host, shown } = start();
		host.edges = {
			start: { x: 150, y: VIEWPORT.top - 10, height: 20 },
			end: { x: 250, y: 120, height: 20 }
		};
		handles.scheduleUpdate();
		await frames();

		const visible = shown();
		expect(visible).toHaveLength(1);
		expect(
			visible[0]?.classList.contains("composery-touch-range-handle-end")
		).toBe(true);
	});

	test("the start grip mirrors at the pane's left edge and not past it", async () => {
		const { handles, host, shown } = start();
		host.edges = {
			start: { x: VIEWPORT.left + 5, y: 120, height: 20 },
			end: { x: 250, y: 120, height: 20 }
		};
		handles.scheduleUpdate();
		await frames();
		const mirrored = shown().find((grip) =>
			grip.classList.contains("composery-touch-range-handle-start")
		);
		expect(
			mirrored?.classList.contains("composery-touch-range-handle-flipped")
		).toBe(true);

		host.edges = {
			start: { x: VIEWPORT.left + 40, y: 120, height: 20 },
			end: { x: 250, y: 120, height: 20 }
		};
		handles.scheduleUpdate();
		await frames();
		const upright = shown().find((grip) =>
			grip.classList.contains("composery-touch-range-handle-start")
		);
		expect(
			upright?.classList.contains("composery-touch-range-handle-flipped")
		).toBe(false);
	});

	test("the finger keeps where it grabbed the grip", async () => {
		const { handles, host, shown, pointer } = start();
		handles.scheduleUpdate();
		await frames();
		const endGrip = shown().find((grip) =>
			grip.classList.contains("composery-touch-range-handle-end")
		)!;

		// The tip of the end edge is (250, 120 - 20/2); grab it 9px right and 14px below.
		pointer(endGrip, "pointerdown", 259, 124);
		expect(host.started).toEqual(["end"]);
		expect(handles.dragging).toBe(true);

		pointer(endGrip, "pointermove", 289, 154);
		// Moved by (30, 30): the edge follows by exactly that, not to the finger itself.
		expect(host.points).toEqual([[280, 140]]);
	});

	test("crossing the anchor swaps the shapes, not the grip under the finger", async () => {
		const { handles, host, shown, pointer } = start();
		handles.scheduleUpdate();
		await frames();
		const endGrip = shown().find((grip) =>
			grip.classList.contains("composery-touch-range-handle-end")
		)!;

		pointer(endGrip, "pointerdown", 250, 110);
		host.kind = "start";
		host.edges = {
			start: { x: 140, y: 120, height: 20 },
			end: { x: 150, y: 120, height: 20 }
		};
		pointer(endGrip, "pointermove", 140, 110);
		await frames();

		expect(
			endGrip.classList.contains("composery-touch-range-handle-start")
		).toBe(true);
		const other = shown().find((grip) => grip !== endGrip)!;
		expect(other.classList.contains("composery-touch-range-handle-end")).toBe(
			true
		);
		// The captured grip is still the one being dragged.
		host.points.length = 0;
		pointer(endGrip, "pointermove", 130, 110);
		expect(host.points).toHaveLength(1);
	});

	test("a finger parked at the edge keeps scrolling and re-dragging", async () => {
		const { handles, host, shown, pointer } = start();
		handles.scheduleUpdate();
		await frames();
		const endGrip = shown().find((grip) =>
			grip.classList.contains("composery-touch-range-handle-end")
		)!;

		pointer(endGrip, "pointerdown", 250, 110);
		host.points.length = 0;
		pointer(endGrip, "pointermove", 250, VIEWPORT.bottom - 5);
		await frames();

		expect(host.scrolled).toBeGreaterThan(0);
		expect(host.points.length).toBeGreaterThan(1);
		const scrolled = host.scrolled;

		pointer(endGrip, "pointerup", 250, VIEWPORT.bottom - 5);
		expect(host.stopped).toBe(1);
		expect(handles.dragging).toBe(false);
		await frames();
		expect(host.scrolled).toBe(scrolled);
	});

	test("a drag beyond the pane still lands inside it", async () => {
		const { handles, host, shown, pointer } = start();
		handles.scheduleUpdate();
		await frames();
		const endGrip = shown().find((grip) =>
			grip.classList.contains("composery-touch-range-handle-end")
		)!;

		pointer(endGrip, "pointerdown", 250, 110);
		host.points.length = 0;
		pointer(endGrip, "pointermove", 250, VIEWPORT.bottom + 200);
		const scrolled = host.points[0];
		if (!scrolled) throw new Error("expected the host to be asked to scroll");
		expect(scrolled[1]).toBeLessThan(VIEWPORT.bottom);
		expect(scrolled[1]).toBeGreaterThan(VIEWPORT.top);
	});

	test("a menu suppresses the grips until the next touch reveals them", async () => {
		const { handles, shown } = start();
		handles.scheduleUpdate();
		await frames();
		expect(shown()).toHaveLength(2);

		handles.suppress();
		expect(shown()).toHaveLength(0);
		handles.scheduleUpdate();
		await frames();
		expect(shown()).toHaveLength(0);

		handles.reveal();
		await frames();
		expect(shown()).toHaveLength(2);
	});

	test("losing the window suppresses the grips and drops the drag", async () => {
		const { window, handles, host, shown, pointer } = start();
		handles.scheduleUpdate();
		await frames();
		const endGrip = shown().find((grip) =>
			grip.classList.contains("composery-touch-range-handle-end")
		)!;
		pointer(endGrip, "pointerdown", 250, 110);

		window.dispatchEvent(new window.Event("blur"));
		expect(handles.dragging).toBe(false);
		expect(host.stopped).toBe(1);
		expect(shown()).toHaveLength(0);

		// Coming back must bring them back. A menu opening over a selection reads as a
		// window blur on Android, and the only other way back is a touch - which ends the
		// selection the menu was opened for.
		window.dispatchEvent(new window.Event("focus"));
		await frames();
		expect(shown()).toHaveLength(2);
	});

	test("a hold on a grip is an adjustment, never a menu", async () => {
		const { handles, shown, pointer } = start();
		handles.scheduleUpdate();
		await frames();
		const grip = shown()[0];
		if (!grip) throw new Error("expected a grip to be shown");
		const event = pointer(grip, "contextmenu", 250, 110);
		expect(event.defaultPrevented).toBe(true);
	});

	test("no selection means no grips, and disposal takes them out of the DOM", async () => {
		const { handles, host, grips, shown } = start();
		handles.scheduleUpdate();
		await frames();
		expect(shown()).toHaveLength(2);

		host.edges = null;
		handles.scheduleUpdate();
		await frames();
		expect(shown()).toHaveLength(0);

		handles.dispose();
		expect(grips()).toHaveLength(0);
	});
});
