import { describe, expect, test } from "vitest";

import {
	buildBeforeLoad,
	choosePlacement,
	INSTALL_SCRIPT,
	TITLEBAR_LEFT_SELECTOR
} from "./back-button";

describe("back-button placement", () => {
	test("places into the title bar when its left slot exists", () => {
		expect(choosePlacement({ hasTitlebarLeft: true })).toBe("titlebar");
	});

	// No fallback: until the title bar exists we wait (the observer retries) —
	// we never inject anything elsewhere.
	test("waits when the title bar isn't present yet", () => {
		expect(choosePlacement({ hasTitlebarLeft: false })).toBe("wait");
	});

	test("the injected script targets the real selector and never floats", () => {
		expect(INSTALL_SCRIPT).toContain(TITLEBAR_LEFT_SELECTOR);
		expect(INSTALL_SCRIPT).toContain("placeTitlebar");
		expect(INSTALL_SCRIPT).not.toContain("float");
		// No Function#toString embed (Hermes wouldn't preserve the source).
		expect(INSTALL_SCRIPT).not.toContain(".toString()");
	});

	// Titlebar-control parity: the states the IDE's own titlebar controls have.
	test("the button covers inactive, focus and touch-hover states", () => {
		expect(INSTALL_SCRIPT).toContain("titleBar-inactiveForeground");
		expect(INSTALL_SCRIPT).toContain(":focus-visible");
		expect(INSTALL_SCRIPT).toContain("focusBorder");
		// Hover only where hover exists - no sticky hover wash after a tap.
		expect(INSTALL_SCRIPT).toContain("@media (hover: hover)");
		// Menubar token family: the button's siblings in .titlebar-left are
		// menubar buttons, not toolbar buttons.
		expect(INSTALL_SCRIPT).toContain("menubar-selectionBackground");
		// Icon comes from the product's codicon font, not a pasted SVG.
		expect(INSTALL_SCRIPT).toContain("codicon-arrow-left");
		expect(INSTALL_SCRIPT).not.toContain("<svg");
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
});
