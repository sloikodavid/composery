import { describe, expect, test } from "vitest";

import {
	BRAND_IDE_THEME,
	BRAND_THEME,
	IDE_THEME_LINKS,
	ideLinked
} from "../packages/shared/index.ts";
import { readRepoFile } from "./support/patchSource.ts";

const CONSOLE_PAGE = "scripts/color-console/app.html";
const SCHEMES = ["light", "dark"] as const;

// #rrggbb / #rrggbbaa -> relative luminance. Alpha is ignored on purpose: the
// relationships below are about the colour a surface paints, and every surface
// role in the palette is opaque.
function luminance(hex: string): number {
	const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
	if (!match) throw new Error(`not a hex colour: ${hex}`);
	const [r = 0, g = 0, b = 0] = match.slice(1, 4).map((part) => {
		const channel = parseInt(part, 16) / 255;
		return channel <= 0.03928
			? channel / 12.92
			: ((channel + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("colour console", () => {
	// The console is the only editor for these palettes, so a role it does not
	// draw a control for is a role nobody can reach - it would keep whatever
	// value it was born with while every other surface moved on.
	test("exposes a control for every role in the palette", () => {
		const page = readRepoFile(CONSOLE_PAGE);
		const exposed = new Set(
			[...page.matchAll(/\["(?:theme|ide)", "(\w+)",/g)].map(([, key]) => key)
		);
		const missing = [
			...Object.keys(BRAND_THEME.light),
			...Object.keys(BRAND_IDE_THEME.light)
		].filter((key) => !exposed.has(key));

		expect(missing).toEqual([]);
	});

	test("every link points at roles that exist on both sides", () => {
		for (const [ideRole, themeRole] of Object.entries(IDE_THEME_LINKS)) {
			expect(BRAND_IDE_THEME.light).toHaveProperty(ideRole);
			expect(BRAND_THEME.light).toHaveProperty(themeRole);
		}
	});

	// A live link stores its source's value rather than a reference, so that every
	// consumer of ideTheme reads a real colour. That only holds while the two are
	// actually equal: a linked role that has drifted is a link the console would
	// silently "restore" on the next apply, changing a colour nobody edited.
	test.each(SCHEMES)("%s: linked roles equal their source", (scheme) => {
		for (const role of ideLinked[scheme]) {
			const source = IDE_THEME_LINKS[role as keyof typeof IDE_THEME_LINKS];
			expect(source, `${role} is linked but has no pairing`).toBeDefined();
			expect(
				BRAND_IDE_THEME[scheme][
					role as keyof (typeof BRAND_IDE_THEME)[typeof scheme]
				],
				`${scheme}.${role} is linked to ${source} but holds a different value`
			).toBe(
				BRAND_THEME[scheme][source as keyof (typeof BRAND_THEME)[typeof scheme]]
			);
		}
	});

	test("both schemes carry the same roles", () => {
		expect(Object.keys(BRAND_THEME.dark)).toEqual(
			Object.keys(BRAND_THEME.light)
		);
		expect(Object.keys(BRAND_IDE_THEME.dark)).toEqual(
			Object.keys(BRAND_IDE_THEME.light)
		);
	});
});

describe("surface relationships", () => {
	// Raised surfaces sit ABOVE the page in both schemes: the site header, the
	// footer, the docs sidebar, cards, inputs and the outline button all paint
	// `card`, and the point of that fill is to read lighter than the page it sits
	// on - a darker one turns the outline button into a well and the docs sidebar
	// into a shadow.
	test.each(SCHEMES)("%s: card is lighter than the page", (scheme) => {
		const colors = BRAND_THEME[scheme];
		expect(luminance(colors.card)).toBeGreaterThan(
			luminance(colors.background)
		);
	});

	test.each(SCHEMES)("%s: popover is lighter still", (scheme) => {
		const colors = BRAND_THEME[scheme];
		expect(luminance(colors.popover)).toBeGreaterThan(luminance(colors.card));
	});

	// The startup page is served before any stylesheet exists and the prebuild
	// plugin runs where the TS package is out of reach, so both hardcode what
	// they cannot import. The console rewrites them on apply; this is what
	// catches a hand-edit that skipped it.
	test("the hand-synced copies still match the palette", () => {
		const startup = readRepoFile(
			"packages/ide/overlay/src/node/persistence/readiness.ts"
		);
		// Every pair, not just one: the page states each scheme twice (the media
		// query and the app's data-scheme override), and a `toContain` would let a
		// stale half hide behind its healthy twin.
		const pairs = [
			...startup.matchAll(/background:(#[0-9a-f]{6});color:(#[0-9a-f]{6})/g)
		].map(([, background, foreground]) => `${background}/${foreground}`);
		const light = `${BRAND_THEME.light.background}/${BRAND_THEME.light.foreground}`;
		const dark = `${BRAND_THEME.dark.background}/${BRAND_THEME.dark.foreground}`;

		expect(pairs).toHaveLength(4);
		expect(pairs.filter((pair) => pair === light)).toHaveLength(2);
		expect(pairs.filter((pair) => pair === dark)).toHaveLength(2);

		const plugin = readRepoFile(
			"packages/mobile/plugins/android-dialog-theme.js"
		);
		expect(plugin).toContain(
			`const ACCENT = { light: "${BRAND_THEME.light.primary}", dark: "${BRAND_THEME.dark.primary}" };`
		);
	});
});
