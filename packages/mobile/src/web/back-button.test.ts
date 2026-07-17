import { describe, expect, test } from "vitest";

import {
	APPICON_SELECTOR,
	buildBeforeLoad,
	choosePlacement,
	INSTALL_SCRIPT,
	TITLEBAR_LEFT_SELECTOR
} from "./back-button";

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
