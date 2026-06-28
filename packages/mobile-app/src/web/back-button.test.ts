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
