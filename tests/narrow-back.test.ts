// The back ladder in shell.js, exercised against a real DOM. Everything here is
// a state machine over layers, history and app messages, and every bug it has had
// was a sequence bug that no amount of reading the source made obvious - so it is
// driven, not grepped.
import { readFileSync } from "node:fs";

import { type DOMWindow, JSDOM } from "jsdom";
import { afterEach, describe, expect, test } from "vitest";

import { transpileToCommonJs } from "./support/patchSource.js";

// The shell is a bundled entry point, so it is TypeScript that imports the two
// gates. Transpile it and resolve those imports the way the bundler does, then
// run the result - still the shipped code, not a copy of it.
const OVERLAY_VSCODE_SRC = "../packages/ide/overlay/lib/vscode/src/vs";
const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
const gates: Record<string, string> = {
	TOUCH_QUERY: /TOUCH_QUERY = '([^']+)'/.exec(
		read(`${OVERLAY_VSCODE_SRC}/base/browser/touchGate.ts`)
	)?.[1] as string,
	NARROW_QUERY: `(max-width: ${
		/NARROW_MAX_WIDTH = (\d+)/.exec(
			read(`${OVERLAY_VSCODE_SRC}/workbench/browser/narrowGate.ts`)
		)?.[1]
	}px)`
};
const source = [
	// The transpiled module opens with a CommonJS preamble; give it somewhere to
	// put its exports and a require() that answers with the real gate values.
	`const exports = {};`,
	`const require = (specifier) => specifier.endsWith("touchGate.js")`,
	`	? { TOUCH_QUERY: ${JSON.stringify(gates.TOUCH_QUERY)} }`,
	`	: { NARROW_QUERY: ${JSON.stringify(gates.NARROW_QUERY)} };`,
	transpileToCommonJs(
		read(`${OVERLAY_VSCODE_SRC}/code/browser/workbench/shell.ts`)
	)
].join("\n");

// Longer than shell.js's own DISMISS_GRACE, so a layer that ignored its Escape
// has been given up on by the time we look.
const AFTER_GRACE = 700;
const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

// What the page adds to its window: the app's marker and bridge, and the back
// entry point shell.js publishes for it.
type PageWindow = DOMWindow & {
	__composeryNative?: boolean;
	__composeryNativeBack?: () => boolean;
	ReactNativeWebView?: { postMessage: (message: string) => void };
};

// Whether the browser guard's sentinel is the current history entry.
const sentinelHeld = (window: PageWindow) =>
	(window.history.state as { composeryBackGuard?: boolean } | null)
		?.composeryBackGuard === true;

type Harness = {
	window: PageWindow;
	messages: string[];
	escapes: KeyboardEvent[];
	closePartEvents: number;
	/** A workbench layer, as the IDE would render it. */
	openLayer(
		className: string,
		options?: { dismissable?: boolean }
	): HTMLElement;
	openPart(): void;
	/** One animation frame plus the microtasks around it. */
	settle(ms?: number): Promise<void>;
	nativeBack(): boolean;
	/** Perform the history.back() the page asked for, if one is being held. */
	releaseHistoryBack(): Promise<void>;
};

const harnesses: JSDOM[] = [];

afterEach(async () => {
	const windows = harnesses.splice(0).map((dom) => dom.window);
	// Stop feeding jsdom's frame loop, then let the frame it already scheduled run:
	// closing a window with a callback still queued throws out of the loop's timer,
	// where no test can catch it.
	for (const window of windows) window.requestAnimationFrame = () => 0;
	await sleep(40);
	for (const window of windows) window.close();
});

function start({
	native = false,
	narrow = true,
	dropsLegacyKeyCode = false,
	holdHistoryBack = false
} = {}): Harness {
	const dom = new JSDOM(
		`<!doctype html><html><body><div class="monaco-workbench nosidebar nopanel noauxiliarybar"></div></body></html>`,
		{
			runScripts: "dangerously",
			pretendToBeVisual: true,
			url: "https://box.example/"
		}
	);
	harnesses.push(dom);
	const window: PageWindow = dom.window;

	// jsdom ships neither, and both decide whether a layer counts at all.
	window.matchMedia = (query: string) =>
		({
			matches: /pointer:\s*coarse/.test(query) ? true : narrow,
			media: query,
			onchange: null,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false
		}) as MediaQueryList;
	window.Element.prototype.getBoundingClientRect = () =>
		({
			width: 120,
			height: 40,
			top: 0,
			left: 0,
			right: 120,
			bottom: 40
		}) as DOMRect;

	if (dropsLegacyKeyCode) {
		// keyCode is a legacy KeyboardEventInit member an engine is free to ignore,
		// and jsdom happens to honour it - so an engine that does not is the only way
		// to see whether the Escape still arrives usable.
		const Engine = window.KeyboardEvent;
		window.KeyboardEvent = class extends Engine {
			constructor(type: string, init: KeyboardEventInit = {}) {
				super(type, { ...init, keyCode: 0, which: 0 });
			}
		};
	}

	const messages: string[] = [];
	if (native) {
		window.__composeryNative = true;
		window.ReactNativeWebView = {
			postMessage: (message: string) => messages.push(message)
		};
	}

	// history.back() is asynchronous, and what the page does in the gap before the
	// popstate lands is the whole question. Hold it open so the gap is ours.
	let held: (() => void) | null = null;
	if (holdHistoryBack) {
		const back = window.history.back.bind(window.history);
		window.history.back = () => {
			held = back;
		};
	}

	const escapes: KeyboardEvent[] = [];
	window.addEventListener(
		"keydown",
		(event) => {
			if (event.key === "Escape") escapes.push(event);
		},
		true
	);
	const harness: Harness = {
		window,
		messages,
		escapes,
		closePartEvents: 0,
		openLayer(className, { dismissable = true } = {}) {
			const layer = window.document.createElement("div");
			layer.className = className;
			window.document.body.appendChild(layer);
			if (dismissable) {
				// Stand-in for the widget's own Escape handling, on its own element as
				// a widget's is - so an Escape aimed at the top layer closes that layer
				// and not every layer under it too. A layer created without this is one
				// whose keybinding never fires: the case that used to wedge back.
				layer.addEventListener("keydown", (event) => {
					if (event.key === "Escape") layer.remove();
				});
			}
			return layer;
		},
		openPart() {
			window.document
				.querySelector(".monaco-workbench")
				?.classList.remove("nopanel");
		},
		settle: (ms = 60) => sleep(ms),
		nativeBack: () => window.__composeryNativeBack?.() ?? false,
		async releaseHistoryBack() {
			if (!held) throw new Error("no history.back() was requested");
			const popped = new Promise<void>((resolve) =>
				window.addEventListener("popstate", () => resolve(), { once: true })
			);
			held();
			held = null;
			await popped;
			await sleep(60);
		}
	};
	window.addEventListener("composery-narrow-close-part", () => {
		harness.closePartEvents++;
	});

	window.eval(source);
	return harness;
}

describe("in the app", () => {
	// syncBackGuard runs on every workbench mutation, and a live terminal produces
	// them by the hundred: only the transitions may cross the bridge.
	test("the layer state is reported on change, not on every frame", async () => {
		const app = start({ native: true });
		const layer = app.openLayer("quick-input-widget");
		await app.settle();
		app.openLayer("monaco-hover");
		layer.setAttribute("data-noise", "1");
		await app.settle();

		expect(app.messages).toEqual(["composery:overlay-back:on"]);
	});

	// The WebView's history holds login redirects and nothing the user asked to
	// return to, so the app never walks it and the page never plants entries for
	// it to walk. Back arrives as a direct call instead.
	test("layers leave session history untouched", async () => {
		const app = start({ native: true });
		const before = app.window.history.length;

		app.openLayer("quick-input-widget");
		await app.settle();

		expect(app.window.history.length).toBe(before);
		expect(sentinelHeld(app.window)).toBe(false);
		expect(app.messages).toContain("composery:overlay-back:on");
	});

	test("back closes the top layer and then reports it gone", async () => {
		const app = start({ native: true });
		app.openLayer("monaco-menu-container");
		await app.settle();
		app.messages.length = 0;

		expect(app.nativeBack()).toBe(true);
		expect(app.escapes).toHaveLength(1);
		await app.settle();

		expect(app.messages).toContain("composery:overlay-back:off");
		expect(app.messages).not.toContain("composery:back");
	});

	// VS Code resolves keybindings from e.keyCode alone (base/browser/
	// keyboardEvent.ts extractKeyCode). An Escape that arrives as keyCode 0 matches
	// nothing and closes nothing, silently - and whether the constructor keeps the
	// keyCode it was handed is up to the engine, so both answers have to work.
	test.each([false, true])(
		"the Escape carries the keyCode VS Code reads (engine drops it: %s)",
		async (dropsLegacyKeyCode) => {
			const app = start({ native: true, dropsLegacyKeyCode });
			app.openLayer("monaco-dialog-box");
			await app.settle();

			app.nativeBack();

			expect(app.escapes[0]?.keyCode).toBe(27);
		}
	);

	test("back with nothing open asks the app to leave", async () => {
		const app = start({ native: true });
		await app.settle();
		app.messages.length = 0;

		expect(app.nativeBack()).toBe(false);
		expect(app.messages).toContain("composery:back");
	});

	// The full-screen side bar / panel / secondary side bar is a layer too, one
	// below the transient overlays: back peels the menu first, then the part.
	test("back closes a full-screen part before leaving", async () => {
		const app = start({ native: true });
		app.openPart();
		const menu = app.openLayer("monaco-menu-container");
		await app.settle();

		expect(app.nativeBack()).toBe(true);
		expect(app.closePartEvents).toBe(0);
		menu.remove();
		await app.settle();

		expect(app.nativeBack()).toBe(true);
		expect(app.closePartEvents).toBe(1);
	});

	// A layer whose Escape does nothing used to swallow every back press after it,
	// leaving the button dead for as long as it stayed up.
	test("a layer that refuses to close stops absorbing back", async () => {
		const app = start({ native: true });
		app.openLayer("context-view", { dismissable: false });
		await app.settle();

		expect(app.nativeBack()).toBe(true);
		await app.settle(AFTER_GRACE);
		expect(app.messages).toContain("composery:overlay-back:off");

		app.messages.length = 0;
		expect(app.nativeBack()).toBe(false);
		expect(app.messages).toContain("composery:back");
	});

	// A peek (or test peek, or merge conflict widget) takes the editor over and is
	// closed with Escape like any other layer, so back has to reach it - and reach
	// it after the popups that sit on top of it, not before.
	test("back peels an in-editor zone widget under the popups above it", async () => {
		const app = start({ native: true });
		app.openLayer("zone-widget");
		const suggest = app.openLayer("suggest-widget");
		await app.settle();

		expect(app.nativeBack()).toBe(true);
		expect(suggest.isConnected).toBe(false);
		await app.settle();

		expect(app.nativeBack()).toBe(true);
		await app.settle();
		expect(app.messages).toContain("composery:overlay-back:off");
	});

	// Every dismissable editor popup a mobile user can reach is a back layer. The
	// standalone color picker is the odd one out - a content widget outside
	// .context-view - so it is the regression this guards: back must close it, not
	// leave the page with it still open.
	test.each([
		"suggest-widget",
		"parameter-hints-widget",
		"rename-box",
		"find-widget",
		"monaco-hover",
		"standalone-colorpicker"
	])("back closes the %s editor popup instead of leaving", async (cls) => {
		const app = start({ native: true });
		const widget = app.openLayer(cls);
		await app.settle();

		expect(app.nativeBack()).toBe(true);
		expect(widget.isConnected).toBe(false);
		expect(app.messages).not.toContain("composery:back");
	});

	// Same rule for the part as for an overlay: if asking did not close it, stop
	// spending back presses on it. One rule, no layer kind exempt from it.
	test("a part that refuses to close stops absorbing back", async () => {
		const app = start({ native: true });
		app.openPart();
		await app.settle();

		expect(app.nativeBack()).toBe(true);
		expect(app.closePartEvents).toBe(1);
		await app.settle(AFTER_GRACE);

		expect(app.messages).toContain("composery:overlay-back:off");
		expect(app.nativeBack()).toBe(false);
		expect(app.closePartEvents).toBe(1);
	});

	// Toasts arrive unasked and expire on their own; spending a back press on one
	// left the part the user meant to close open, and read as a dead press.
	test("a notification toast is not something back closes", async () => {
		const app = start({ native: true });
		app.openLayer("notification-toast-container");
		await app.settle();

		expect(app.messages).not.toContain("composery:overlay-back:on");
		expect(app.nativeBack()).toBe(false);
		expect(app.messages).toContain("composery:back");
	});
});

describe("in a browser", () => {
	// No app to call us, so a layer parks a sentinel entry and the browser's own
	// back gesture spends itself popping that instead of leaving the page.
	test("a layer arms a history sentinel and back dismisses it", async () => {
		const web = start();
		web.openLayer("quick-input-widget");
		await web.settle();

		expect(sentinelHeld(web.window)).toBe(true);

		const popped = new Promise<void>((resolve) =>
			web.window.addEventListener("popstate", () => resolve(), { once: true })
		);
		web.window.history.back();
		await popped;

		expect(web.escapes).toHaveLength(1);
	});

	// Retiring a sentinel is an async history.back(), and a layer that opens while
	// one is in flight adopts the entry that pop is about to retire. The guard was
	// then armed with no sentinel behind it, and the next back left the page - the
	// unexplained exits this whole ladder exists to prevent.
	test("a layer opening during a disarm keeps a sentinel behind it", async () => {
		const web = start({ holdHistoryBack: true });
		const first = web.openLayer("quick-input-widget");
		await web.settle();
		expect(sentinelHeld(web.window)).toBe(true);

		// The last layer closes, so the page asks for its sentinel back...
		first.remove();
		await web.settle();
		// ...and a new layer opens while that request is still in the air, adopting
		// the entry it is about to retire.
		web.openLayer("monaco-menu-container");
		await web.settle();
		await web.releaseHistoryBack();

		expect(sentinelHeld(web.window)).toBe(true);
	});

	// Closing the last layer by other means (tapping outside) has to give the
	// sentinel back, or the next back press is spent on a layer that is not there.
	test("closing the last layer retires the sentinel", async () => {
		const web = start();
		const layer = web.openLayer("quick-input-widget");
		await web.settle();

		layer.remove();
		await web.settle(200);

		expect(sentinelHeld(web.window)).toBe(false);
	});

	// Device-seen 2026-07-21 in Chrome: a menu over an open panel, back closed the
	// menu, and the very next back hit "Leave site?" instead of closing the panel.
	// The pop retires the sentinel, and if the re-arm waits for the layer to animate
	// out, a back in that window finds no sentinel and reaches real navigation. When
	// a lower layer is still open the sentinel must be back synchronously, before the
	// next back can land - not one timer later.
	test("a lower layer keeps its sentinel the instant the top one is peeled", async () => {
		const web = start();
		web.openPart(); // the lower layer
		const menu = web.openLayer("monaco-menu-container"); // the top layer
		await web.settle();
		expect(sentinelHeld(web.window)).toBe(true);

		// The browser back that peels the menu: pop the sentinel, then let the pop
		// handler run. The menu closes synchronously, as a real menu does on Escape.
		const popped = new Promise<void>((resolve) =>
			web.window.addEventListener("popstate", () => resolve(), { once: true })
		);
		web.window.history.back();
		await popped;
		menu.remove();

		// No settle(): the sentinel must already be back for the part, with no timer
		// having fired, or a second back here escapes to the page.
		expect(sentinelHeld(web.window)).toBe(true);
	});
});
