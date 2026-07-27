import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import { BRAND_IDE_THEME, BRAND_THEME } from "../packages/shared/index.ts";
import { readRepoFile } from "./support/patchSource.ts";

const repoRoot = resolve(import.meta.dirname, "..");
const schemes = ["light", "dark"] as const;

const source = JSON.parse(
	readFileSync(resolve(repoRoot, "packages/shared/theme.json"), "utf8")
) as {
	web: typeof BRAND_THEME;
	ide: typeof BRAND_IDE_THEME;
};

function composite(
	color: string,
	background: string
): [number, number, number] {
	const match = /^#(..)(..)(..)(..)?$/i.exec(color);
	const backdrop = /^#(..)(..)(..)/i.exec(background);
	if (!match || !backdrop) throw new Error(`not a hex colour: ${color}`);
	const alpha = match[4] ? parseInt(match[4], 16) / 255 : 1;
	return [1, 2, 3].map((index) =>
		Math.round(
			parseInt(match[index]!, 16) * alpha +
				parseInt(backdrop[index]!, 16) * (1 - alpha)
		)
	) as [number, number, number];
}

function luminance(channels: [number, number, number]): number {
	const [r, g, b] = channels.map((value) => {
		const channel = value / 255;
		return channel <= 0.03928
			? channel / 12.92
			: ((channel + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(foreground: string, background: string): number {
	const first = luminance(composite(foreground, background));
	const second = luminance(composite(background, background));
	return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe("shared theme", () => {
	test("the editable source is exported without a second copy", () => {
		expect(BRAND_THEME).toEqual(source.web);
		expect(BRAND_IDE_THEME).toEqual(source.ide);
	});

	test("both schemes expose the same website and IDE roles", () => {
		expect(Object.keys(BRAND_THEME.light)).toEqual(
			Object.keys(BRAND_THEME.dark)
		);
		expect(Object.keys(BRAND_IDE_THEME.light)).toEqual(
			Object.keys(BRAND_IDE_THEME.dark)
		);
	});

	test("every editable value is canonical hex or hex-alpha", () => {
		for (const area of Object.values(source))
			for (const values of Object.values(area))
				for (const color of Object.values(values))
					expect(color).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
	});

	test.each(schemes)("%s status roles are distinct", (scheme) => {
		const colors = BRAND_THEME[scheme];
		expect(
			new Set([colors.success, colors.warning, colors.destructive, colors.info])
				.size
		).toBe(4);
	});

	test.each(schemes)("%s normal text meets WCAG AA contrast", (scheme) => {
		const colors = BRAND_THEME[scheme];
		for (const [name, foreground, background] of [
			["page", colors.foreground, colors.background],
			["muted page", colors.mutedForeground, colors.background],
			["card", colors.cardForeground, colors.card],
			["muted card", colors.mutedForeground, colors.card],
			["popover", colors.popoverForeground, colors.popover],
			["primary", colors.primaryForeground, colors.primary],
			["secondary", colors.secondaryForeground, colors.secondary]
		] as const)
			expect(contrast(foreground, background), name).toBeGreaterThanOrEqual(
				4.5
			);
	});
});

describe("generated editor themes", () => {
	const readTheme = (scheme: (typeof schemes)[number]) =>
		JSON.parse(
			readRepoFile(
				`packages/ide/overlay/lib/vscode/extensions/composery-themes/themes/composery-${scheme}.json`
			)
		) as {
			colors: Record<string, string>;
			semanticTokenColors: Record<string, string | { foreground?: string }>;
			tokenColors: {
				name?: string;
				scope?: string | string[];
				settings?: { foreground?: string };
			}[];
		};

	test.each(schemes)(
		"%s diagnostics, Git decorations, and ANSI statuses share product roles",
		(scheme) => {
			const theme = readTheme(scheme);
			const colors = BRAND_THEME[scheme];
			for (const [role, keys] of [
				[
					"success",
					[
						"editorGutter.addedBackground",
						"gitDecoration.addedResourceForeground",
						"terminal.ansiGreen"
					]
				],
				[
					"warning",
					[
						"editorWarning.foreground",
						"gitDecoration.conflictingResourceForeground",
						"terminal.ansiYellow"
					]
				],
				[
					"destructive",
					[
						"editorError.foreground",
						"gitDecoration.deletedResourceForeground",
						"terminal.ansiRed"
					]
				],
				[
					"info",
					[
						"editorInfo.foreground",
						"notificationsInfoIcon.foreground",
						"terminal.ansiBlue"
					]
				]
			] as const)
				for (const key of keys)
					expect(theme.colors[key], `${role}: ${key}`).toBe(colors[role]);
		}
	);

	test.each(schemes)(
		"%s workbench and terminal neutrals follow the editable IDE roles",
		(scheme) => {
			const theme = readTheme(scheme);
			const colors = BRAND_IDE_THEME[scheme];
			for (const [role, keys] of [
				[
					"chrome",
					[
						"activityBar.background",
						"sideBar.background",
						"statusBar.background",
						"titleBar.activeBackground"
					]
				],
				["editor", ["editor.background", "terminal.background"]],
				[
					"surface",
					[
						"editorWidget.background",
						"quickInput.background",
						"tab.activeBackground"
					]
				],
				["hover", ["list.hoverBackground", "quickInputList.focusBackground"]],
				["foreground", ["editor.foreground", "terminal.foreground"]],
				["mutedForeground", ["descriptionForeground"]],
				["border", ["editorWidget.border", "widget.border"]],
				["focus", ["focusBorder"]],
				["shadow", ["widget.shadow"]],
				["primary", ["button.background"]],
				["primaryForeground", ["button.foreground"]],
				["lineNumber", ["editorLineNumber.foreground"]],
				["ignored", ["gitDecoration.ignoredResourceForeground"]],
				["ansiBlack", ["terminal.ansiBlack"]],
				["ansiMagenta", ["terminal.ansiMagenta"]],
				["ansiCyan", ["terminal.ansiCyan"]],
				["ansiWhite", ["terminal.ansiWhite"]],
				["ansiBrightBlack", ["terminal.ansiBrightBlack"]]
			] as const)
				for (const key of keys)
					expect(theme.colors[key], `${role}: ${key}`).toBe(colors[role]);
		}
	);

	test.each(schemes)("%s syntax follows the editable IDE roles", (scheme) => {
		const theme = readTheme(scheme);
		const colors = BRAND_IDE_THEME[scheme];
		const ruleFor = (scope: string) =>
			theme.tokenColors.find((rule) => {
				const scopes = Array.isArray(rule.scope) ? rule.scope : [rule.scope];
				return scopes.includes(scope);
			});
		const functionRule = theme.tokenColors.find(
			(rule) => rule.name === "Function declarations"
		);

		expect(functionRule?.settings?.foreground).toBe(colors.function);
		expect(ruleFor("constant.numeric")?.settings?.foreground).toBe(
			colors.number
		);
		expect(ruleFor("comment")?.settings?.foreground).toBe(colors.comment);
		expect(ruleFor("string")?.settings?.foreground).toBe(colors.string);
		expect(theme.semanticTokenColors.numberLiteral).toBe(colors.number);
		expect(theme.semanticTokenColors.stringLiteral).toBe(colors.string);
	});
});

describe("theme editor", () => {
	test("pnpm dev includes the shared theme editor", () => {
		const rootPackage = JSON.parse(readRepoFile("package.json")) as {
			scripts: Record<string, string>;
		};
		const sharedPackage = JSON.parse(
			readRepoFile("packages/shared/package.json")
		) as {
			scripts: Record<string, string>;
		};
		expect(rootPackage.scripts["dev:theme"]).toBe(
			"pnpm --filter shared dev:theme"
		);
		expect(rootPackage.scripts.dev).toContain('"pnpm dev:theme"');
		expect(sharedPackage.scripts["dev:theme"]).toBe(
			"node tools/theme/server.mjs"
		);
	});

	test("the focused editor exposes every website and IDE role as hex", () => {
		const page = readRepoFile("packages/shared/tools/theme/index.html");

		expect(page).toContain('data-value="web"');
		expect(page).toContain('data-value="ide"');
		expect(page).toContain("const WEBSITE =");
		expect(page).toContain("const IDE =");
		expect(page).not.toContain("const MOBILE =");
		expect(page).not.toContain("const DOCS =");
		expect(page).toContain('text.type = "text"');
		expect(page).toContain("text.value = current()");
		expect(page).toContain("grid-template-columns: minmax(0, 1fr) 30px 94px");
		for (const area of Object.values(source))
			for (const role of Object.keys(area.light))
				expect(page, role).toContain(`["${role}",`);
	});
});
