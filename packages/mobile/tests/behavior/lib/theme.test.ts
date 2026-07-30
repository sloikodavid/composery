import { describe, expect, test } from "vitest";
import { BRAND_THEME } from "shared";

import { dark, light, themeForScheme, type Palette } from "@/lib/theme";

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

	test("button and buttonForeground contrast in both themes", () => {
		expect(light.button).not.toBe(light.buttonForeground);
		expect(dark.button).not.toBe(dark.buttonForeground);
	});

	test("light button matches the shared brand palette", () => {
		expect(light.button).toBe(BRAND_THEME.light.button);
	});

	test("dark button matches the shared brand palette", () => {
		expect(dark.button).toBe(BRAND_THEME.dark.button);
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
