import { describe, expect, test } from "vitest";
import { BRAND_THEME } from "shared";

import { dark, light, themeForScheme, type Palette } from "./theme";

// #rrggbb or #rrggbbaa — React Native parses both; the palette uses the alpha
// form for translucent borders/inputs (e.g. #ffffff1f).
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;
const RGBA = /^rgba\(\d+,\s*\d+,\s*\d+,\s*0?\.\d+\)$/;

function assertValidColors(palette: Palette, label: string) {
	for (const [key, value] of Object.entries(palette)) {
		test(`${label}.${key} is a hex or rgba color React Native can parse`, () => {
			expect(
				HEX.test(value) || RGBA.test(value),
				`${label}.${key}=${value} is not a valid #rrggbb or rgba() string`
			).toBe(true);
		});
	}
}

describe("theme palette", () => {
	test("light and dark expose the same keys", () => {
		expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
	});

	test("primary and primaryForeground contrast in both themes", () => {
		expect(light.primary).not.toBe(light.primaryForeground);
		expect(dark.primary).not.toBe(dark.primaryForeground);
	});

	test("primary light matches the shared brand palette", () => {
		expect(light.primary).toBe(BRAND_THEME.light.primary);
	});

	test("primary dark matches the shared brand palette", () => {
		expect(dark.primary).toBe(BRAND_THEME.dark.primary);
	});

	test("selects the palette for a React Native color scheme", () => {
		expect(themeForScheme("dark")).toBe(dark);
		expect(themeForScheme("light")).toBe(light);
		expect(themeForScheme("unspecified")).toBe(light);
		expect(themeForScheme(null)).toBe(light);
	});

	assertValidColors(light, "light");
	assertValidColors(dark, "dark");
});
