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

	// No fallback: until the title bar exists we wait (the observer retries) -
	// we never inject anything elsewhere.
	test("waits when the title bar isn't present yet", () => {
		expect(choosePlacement({ hasTitlebarLeft: false })).toBe("wait");
	});

	test("the injected script targets the real selector and never floats", () => {
		expect(INSTALL_SCRIPT).toContain(TITLEBAR_LEFT_SELECTOR);
		expect(INSTALL_SCRIPT).toContain("placeTitlebar");
		expect(INSTALL_SCRIPT).toContain("composery:back");
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
		expect(INSTALL_SCRIPT).toContain("translateY(1px)");
	});

	test("uses the IDE back arrow codicon", () => {
		expect(INSTALL_SCRIPT).toContain("codicon-arrow-left");
		expect(INSTALL_SCRIPT).toContain('#" + ID + " .codicon');
		expect(INSTALL_SCRIPT).not.toContain("<svg");
		expect(INSTALL_SCRIPT).not.toContain("composery-icon-holes");
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

describe("menubar pairing CSS", () => {
	// A bare .menubar-menu-button width rule would force File/Edit/... to 22px
	// and poison the menubar's overflow measurement (it reads offsetWidth), so
	// labels smush instead of collapsing into the overflow menu.
	test("22px box applies to the overflow button only", () => {
		for (const line of INSTALL_SCRIPT.split("\n")) {
			if (line.includes("width:22px") && line.includes("menubar-menu-button")) {
				expect(line).toContain(":has(.toolbar-toggle-more)");
			}
		}
		expect(INSTALL_SCRIPT).toContain(
			".menubar-menu-button:has(.toolbar-toggle-more)"
		);
	});
});
