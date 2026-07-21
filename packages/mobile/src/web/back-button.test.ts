import { describe, expect, test } from "vitest";

import {
	APPICON_SELECTOR,
	buildBeforeLoad,
	choosePlacement,
	INSTALL_SCRIPT,
	NATIVE_BACK_SCRIPT,
	TITLEBAR_LEFT_SELECTOR,
	USABLE_BG_SOURCE
} from "./back-button";

// The rule ships as source, so the test runs that source rather than a
// second copy of it.
const usableBg = new Function(`${USABLE_BG_SOURCE}; return usableBg;`)() as (
	bg: string | null | undefined
) => string | null;

describe("status-bar strip color", () => {
	test("takes an opaque background", () => {
		expect(usableBg("rgb(10, 10, 10)")).toBe("rgb(10, 10, 10)");
		expect(usableBg("rgba(255, 255, 255, 1)")).toBe("rgba(255, 255, 255, 1)");
	});

	// The bug this rule exists for: a theme setting titleBar.activeBackground with
	// 8-digit hex computes to a translucent white over a black workbench. Reported
	// as-is it paints a near-black strip but scores as light, so the app picks dark
	// status-bar icons - black on black.
	test("rejects a translucent background so the surface under it is used", () => {
		expect(usableBg("rgba(255, 255, 255, 0.06)")).toBeNull();
		expect(usableBg("rgba(0, 0, 0, 0)")).toBeNull();
	});

	// Anything the app's own rgb parser (isLight in instance/[id].tsx) and React
	// Native's style parser cannot both read is not a colour we can report.
	test("rejects colors that are not rgb()", () => {
		expect(usableBg("transparent")).toBeNull();
		expect(usableBg("color(srgb 0.04 0.04 0.04)")).toBeNull();
		expect(usableBg("oklch(0.2 0 0)")).toBeNull();
		expect(usableBg("")).toBeNull();
		expect(usableBg(null)).toBeNull();
	});

	// No opaque surface anywhere reports empty and the app keeps its own
	// background. A guessed white would be a white bar over a dark app.
	test("the script never guesses a color", () => {
		expect(INSTALL_SCRIPT).toContain(USABLE_BG_SOURCE);
		expect(INSTALL_SCRIPT).not.toContain("rgb(255, 255, 255)");
	});
});

describe("back-button placement", () => {
	test("rewires the logo when it exists", () => {
		expect(choosePlacement({ hasAppicon: true })).toBe("titlebar");
	});

	// No fallback: until the logo exists we wait (the observer retries) - we
	// never inject anything elsewhere.
	test("waits when the logo isn't present yet", () => {
		expect(choosePlacement({ hasAppicon: false })).toBe("wait");
	});

	test("the injected script targets the real selector and never floats", () => {
		expect(INSTALL_SCRIPT).toContain(TITLEBAR_LEFT_SELECTOR);
		expect(INSTALL_SCRIPT).toContain("placeTitlebar");
		expect(INSTALL_SCRIPT).toContain("composery:back");
		expect(INSTALL_SCRIPT).not.toContain("float");
		// No Function#toString embed (Hermes wouldn't preserve the source).
		expect(INSTALL_SCRIPT).not.toContain(".toString()");
	});

	// The control is the IDE's own title-bar logo, rewired - never a lookalike
	// button, so its size/icon/theming can't drift from the IDE's CSS.
	test("rewires the appicon instead of building a replacement", () => {
		expect(INSTALL_SCRIPT).toContain(APPICON_SELECTOR);
		// The href would navigate the WebView to the website and trigger the
		// logo's link context menu on long-press.
		expect(INSTALL_SCRIPT).toContain('removeAttribute("href")');
		expect(INSTALL_SCRIPT).toContain('"role", "button"');
		// Anchors without href have no native keyboard activation.
		expect(INSTALL_SCRIPT).toContain("keydown");
		// No lookalike and no layout overrides: the IDE's own CSS owns the
		// logo's look and the titlebar's sizing.
		expect(INSTALL_SCRIPT).not.toContain("codicon-arrow-left");
		expect(INSTALL_SCRIPT).not.toContain("<svg");
		expect(INSTALL_SCRIPT).not.toContain('createElement("a")');
		expect(INSTALL_SCRIPT).not.toContain("titlebar-left{");
	});

	test("the appicon is touch- and keyboard-usable", () => {
		// No sticky hover wash after a tap on touch screens.
		expect(INSTALL_SCRIPT).toContain("@media (hover: none)");
		expect(INSTALL_SCRIPT).toContain(":focus-visible");
		expect(INSTALL_SCRIPT).toContain("focusBorder");
	});
});

describe("hardware back", () => {
	test("asks the page to close its top layer", () => {
		expect(NATIVE_BACK_SCRIPT).toContain("window.__composeryNativeBack()");
		// Absent (an error page, a load that never finished) the call is skipped
		// rather than throwing into a WebView nobody can see the console of.
		expect(NATIVE_BACK_SCRIPT).toContain("window.__composeryNativeBack &&");
	});

	// The workbench defines its own, knowing its menus, dialogs and full-screen
	// parts; this script runs at load end, after it. Overwriting it would reduce
	// every back press inside the IDE to "leave for the instances list".
	test("the fallback never displaces the workbench's own", () => {
		expect(INSTALL_SCRIPT).toContain("if (!window.__composeryNativeBack)");
		const fallback = INSTALL_SCRIPT.slice(
			INSTALL_SCRIPT.indexOf("if (!window.__composeryNativeBack)")
		);
		expect(fallback.slice(0, 200)).toContain('post("composery:back")');
	});
});

describe("color-scheme override", () => {
	test("only synthesizes prefers-color-scheme, passing other queries through", () => {
		const script = buildBeforeLoad("dark");
		expect(script).toContain('"dark"');
		expect(script).toContain("prefers-color-scheme");
		expect(script).toContain("return real(query)");
		expect(script).toContain("__composerySetScheme");
	});

	// CSS media queries can't be shimmed, so pages key scheme CSS on the
	// data-scheme attribute the app stamps (and restamps on live flips).
	test("stamps data-scheme for CSS and restamps on scheme flips", () => {
		const script = buildBeforeLoad("dark");
		expect(script).toContain("dataset.scheme");
		// The live-flip path restamps: stampScheme() is called inside setScheme.
		const setScheme = script.slice(script.indexOf("__composerySetScheme"));
		expect(setScheme).toContain("stampScheme()");
	});
});

describe("menubar", () => {
	// The old lookalike button shrank the overflow hamburger to pair with its
	// 22px box; the native 35px appicon pairs with the native menubar as-is, so
	// the script must not touch menubar sizing (a bare .menubar-menu-button
	// width rule would poison the menubar's own overflow measurement).
	test("the script leaves menubar sizing alone", () => {
		expect(INSTALL_SCRIPT).not.toContain("width:22px");
		expect(INSTALL_SCRIPT).not.toContain("toolbar-toggle-more");
	});
});
