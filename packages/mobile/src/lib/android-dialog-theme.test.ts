import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { BRAND_THEME } from "shared";
import { describe, expect, test } from "vitest";

// The config plugin is CommonJS loaded by Expo CLI's plain require at prebuild,
// so it cannot import the TS `shared` package and carries its own hex copies.
// This test is the tie that keeps those copies from drifting.
const require = createRequire(import.meta.url);
const expoRequire = createRequire(require.resolve("expo/bin/cli"));
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

	test("Expo prebuild receives both theme attributes and day/night colors", async () => {
		// Assert the artifact Expo generates, not just the plugin callback we hope
		// produces it. Ignore an existing gitignored android/ tree: reading yesterday's
		// generated XML would let a broken plugin look green until a clean CI prebuild.
		const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
		const { getPrebuildConfigAsync } = expoRequire("@expo/prebuild-config") as {
			getPrebuildConfigAsync: (
				root: string,
				options: { platforms: string[] }
			) => Promise<{ exp: unknown }>;
		};
		const { compileModsAsync } = expoRequire("@expo/config-plugins") as {
			compileModsAsync: (
				config: unknown,
				options: Record<string, unknown>
			) => Promise<unknown>;
		};
		const prebuild = await getPrebuildConfigAsync(projectRoot, {
			platforms: ["android"]
		});
		await compileModsAsync(prebuild.exp, {
			projectRoot,
			introspect: true,
			platforms: ["android"],
			assertMissingModProviders: false,
			ignoreExistingNativeFiles: true
		});
		const config = prebuild.exp as {
			_internal: {
				modResults: {
					android: {
						styles: { resources: { style: AndroidStyle[] } };
						colors: AndroidColors;
						colorsNight: AndroidColors;
					};
				};
			};
		};
		const android = config._internal.modResults.android;
		const appTheme = android.styles.resources.style.find(
			(style) => style.$.name === "AppTheme"
		);
		const items = Object.fromEntries(
			(appTheme?.item ?? []).map((item) => [item.$.name, item._])
		);
		const colors = (value: AndroidColors) =>
			Object.fromEntries(
				value.resources.color.map((color) => [color.$.name, color._])
			);

		expect(items.colorAccent).toBe(`@color/${plugin.COLOR_NAME}`);
		expect(items["android:colorAccent"]).toBe(`@color/${plugin.COLOR_NAME}`);
		expect(colors(android.colors)[plugin.COLOR_NAME]).toBe(plugin.ACCENT.light);
		expect(colors(android.colorsNight)[plugin.COLOR_NAME]).toBe(
			plugin.ACCENT.dark
		);
	}, 30_000);
});

type AndroidStyle = {
	$: { name: string };
	item?: { _: string; $: { name: string } }[];
};

type AndroidColors = {
	resources: { color: { _: string; $: { name: string } }[] };
};
