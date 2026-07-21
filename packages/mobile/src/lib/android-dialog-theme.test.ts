import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { BRAND_THEME } from "shared";
import { describe, expect, test } from "vitest";

// The config plugin is CommonJS loaded by Expo CLI's plain require at prebuild,
// so it cannot import the TS `shared` package and carries its own hex copies.
// This test is the tie that keeps those copies from drifting.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require("../../plugins/android-dialog-theme.js") as {
	(config: unknown): unknown;
	ACCENT: { light: string; dark: string };
	COLOR_NAME: string;
};

describe("android-dialog-theme plugin", () => {
	test("accent colors match the brand primary", () => {
		expect(plugin.ACCENT.light).toBe(BRAND_THEME.light.primary);
		expect(plugin.ACCENT.dark).toBe(BRAND_THEME.dark.primary);
	});

	// composery- prefix required: the color lands in Android's merged resource
	// namespace, where an unprefixed name can silently override a library's.
	test("color resource name is namespaced", () => {
		expect(plugin.COLOR_NAME).toMatch(/^composery/);
	});

	// A plugin nothing loads themes nothing: the wiring is part of the feature.
	test("app.json wires the plugin", () => {
		const appJson = JSON.parse(
			readFileSync(new URL("../../app.json", import.meta.url), "utf8")
		) as { expo: { plugins: unknown[] } };
		expect(appJson.expo.plugins).toContain("./plugins/android-dialog-theme.js");
	});
});
