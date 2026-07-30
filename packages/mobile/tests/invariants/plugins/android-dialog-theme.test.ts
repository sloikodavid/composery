// Expo must read the plugin path from static app.json, while the CommonJS
// prebuild plugin cannot import the TypeScript shared theme. Neither duplicate
// can be removed or derived at runtime, so this pins both external-tool copies
// to their canonical repository values.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { BRAND_THEME } from "shared";

type AndroidDialogTheme = {
	ACCENT: { dark: string; light: string };
	COLOR_NAME: string;
};

const require = createRequire(import.meta.url);
const plugin =
	require("../../../plugins/android-dialog-theme.js") as AndroidDialogTheme;
const app = JSON.parse(
	readFileSync(new URL("../../../app.json", import.meta.url), "utf8")
) as { expo: { plugins: unknown[] } };

describe("android dialog theme static wiring", () => {
	test("keeps the CommonJS accent copies on the shared control colour", () => {
		expect(plugin.ACCENT).toEqual({
			light: BRAND_THEME.light.control,
			dark: BRAND_THEME.dark.control
		});
	});

	test("keeps the namespaced plugin wired into Expo prebuild", () => {
		expect(plugin.COLOR_NAME).toMatch(/^composery/);
		expect(app.expo.plugins).toContain("./plugins/android-dialog-theme.js");
	});
});
