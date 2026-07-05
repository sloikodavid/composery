import { describe, expect, test } from "vitest";

import {
	buildBeforeLoad,
	choosePlacement,
	INSTALL_SCRIPT,
	APPICON_SELECTOR
} from "./back-button";

describe("home-button wiring", () => {
	test("wires the Home action once the logo exists", () => {
		expect(choosePlacement({ hasAppIcon: true })).toBe("appicon");
	});

	// Until the title bar's logo exists we wait (the observer retries) — we never
	// inject a separate control.
	test("waits when the logo isn't present yet", () => {
		expect(choosePlacement({ hasAppIcon: false })).toBe("wait");
	});

	test("reuses the real logo element and never builds/floats its own button", () => {
		expect(INSTALL_SCRIPT).toContain(APPICON_SELECTOR);
		expect(INSTALL_SCRIPT).toContain("wireHome");
		expect(INSTALL_SCRIPT).toContain("composery:back");
		// No pasted icon and no injected control — we ride the IDE's own logo.
		expect(INSTALL_SCRIPT).not.toContain("<svg");
		expect(INSTALL_SCRIPT).not.toContain("createElement");
		expect(INSTALL_SCRIPT).not.toContain("float");
		// No Function#toString embed (Hermes wouldn't preserve the source).
		expect(INSTALL_SCRIPT).not.toContain(".toString()");
	});

	test("the click is captured and defanged so the anchor can't navigate", () => {
		expect(INSTALL_SCRIPT).toContain("preventDefault");
		expect(INSTALL_SCRIPT).toContain("stopPropagation");
		// Capture-phase listener (third arg true).
		expect(INSTALL_SCRIPT).toContain('"click", function (e) {');
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
