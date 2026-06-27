import { describe, expect, test } from "vitest";

import { dark, light, type Palette } from "./theme";

const HEX = /^#[0-9a-f]{6}$/;
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

	test("primary light is the derived hex for oklch(0.55 0.12 64)", () => {
		expect(light.primary).toBe("#a1600d");
	});

	test("primary dark is the derived hex for oklch(0.6 0.14 64)", () => {
		expect(dark.primary).toBe("#b86a00");
	});

	assertValidColors(light, "light");
	assertValidColors(dark, "dark");
});
