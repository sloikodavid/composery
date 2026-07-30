import { beforeEach, describe, expect, test, vi } from "vitest";

import { ideTheme, theme } from "../../../index.ts";

const firstPaintKeys = `
checkbox.border editor.background editor.foreground editor.inactiveSelectionBackground
editorIndentGuide.background1 editorIndentGuide.activeBackground1 editor.selectionHighlightBackground
editorSuggestWidget.background activityBarBadge.background sideBarTitle.foreground
list.hoverBackground menu.border input.placeholderForeground searchEditor.textInputBorder
settings.textInputBorder settings.numberInputBorder statusBarItem.remoteForeground
statusBarItem.remoteBackground ports.iconRunningProcessForeground sideBarSectionHeader.background
sideBarSectionHeader.border tab.selectedForeground tab.selectedBackground tab.lastPinnedBorder
notebook.cellBorderColor notebook.selectedCellBackground statusBarItem.errorBackground
list.activeSelectionIconForeground list.focusAndSelectionOutline terminal.inactiveSelectionBackground
widget.border actionBar.toggledBackground diffEditor.unchangedRegionBackground
agentsNewSessionButton.border agentsChatInput.border activityBar.activeBorder activityBar.background
activityBar.border activityBar.foreground activityBar.inactiveForeground activityBarBadge.foreground
badge.background badge.foreground button.background button.border button.foreground
button.hoverBackground button.secondaryBackground button.secondaryForeground
button.secondaryHoverBackground chat.slashCommandBackground chat.slashCommandForeground
chat.editedFileForeground checkbox.background descriptionForeground dropdown.background
dropdown.border dropdown.foreground dropdown.listBackground editorGroup.border
editorGroupHeader.tabsBackground editorGroupHeader.tabsBorder editorGutter.addedBackground
editorGutter.deletedBackground editorGutter.modifiedBackground editorLineNumber.activeForeground
editorLineNumber.foreground editorOverviewRuler.border editorWidget.background errorForeground
focusBorder foreground icon.foreground input.background input.border input.foreground
inputOption.activeBackground inputOption.activeBorder inputOption.activeForeground
keybindingLabel.foreground list.activeSelectionBackground list.activeSelectionForeground
menu.selectionBackground menu.selectionForeground notificationCenterHeader.background
notificationCenterHeader.foreground notifications.background notifications.border
notifications.foreground panel.background panel.border panelInput.border panelTitle.activeBorder
panelTitle.activeForeground panelTitle.inactiveForeground peekViewEditor.matchHighlightBackground
peekViewResult.background peekViewResult.matchHighlightBackground pickerGroup.border
pickerGroup.foreground progressBar.background quickInput.background quickInput.foreground
settings.dropdownBackground settings.dropdownBorder settings.headerForeground
settings.modifiedItemIndicator sideBar.background sideBar.border sideBar.foreground
sideBarSectionHeader.foreground statusBar.background statusBar.foreground statusBar.border
statusBarItem.hoverBackground statusBarItem.hoverForeground statusBarItem.compactHoverBackground
statusBar.debuggingBackground statusBar.debuggingForeground statusBar.focusBorder
`
	.trim()
	.split(/\s+/);

const tokenRules = [
	["comment.line", "#010101"],
	["constant.character.escape.js", "#010101"],
	["string.regexp", "#010101"],
	["string.quoted", "#010101"],
	["meta.decorator", "#010101"],
	["support.function", "#010101"],
	["entity.name.namespace", "#010101"],
	["entity.name.tag", "#010101"],
	["support.class", "#010101"],
	["constant.numeric", "#010101"],
	["keyword.operator", "#010101"],
	["storage.modifier", "#010101"],
	["variable.parameter", "#010101"],
	["variable.other.property", "#010101"],
	["entity.other.attribute-name", "#010101"],
	["entity.name.label", "#010101"],
	["support.constant", "#010101"],
	["variable.other", "#010101"],
	["punctuation.definition", "#010101"],
	["markup.inserted.diff", "#010101"],
	["markup.deleted.diff", "#010101"],
	["markup.changed.diff", "#010101"],
	["invalid.illegal", "#010101"],
	["source.unclassified", "#010101"]
].map(([scope, foreground]) => ({ scope, settings: { foreground } }));

const semanticTokenColors = Object.fromEntries(
	[
		"comment",
		"regexpToken",
		"stringToken",
		"numberToken",
		"decoratorToken",
		"namespaceToken",
		"labelToken",
		"functionToken",
		"methodToken",
		"customLiteralToken",
		"classToken",
		"enumToken",
		"interfaceToken",
		"structToken",
		"typeToken",
		"operatorToken",
		"keywordToken",
		"parameterToken",
		"propertyToken",
		"variableToken",
		"unknownToken"
	].map((key, index) => [
		key,
		index % 2 === 0 ? "#010101" : { foreground: "#010101", bold: true }
	])
);

function upstreamTheme() {
	return {
		include: "./base.json",
		colors: { "child.color": "#020202" },
		semanticTokenColors,
		tokenColors: [
			...tokenRules,
			{
				scope: ["comment.block", "string.quoted"],
				settings: { fontStyle: "bold" }
			}
		]
	};
}

function firstPaintPatch() {
	const block = (scheme: string) => [
		`+const COLOR_THEME_${scheme.toUpperCase()}_INITIAL_COLORS = {`,
		...firstPaintKeys.map((key) => `+\t'${key}': '#010101',`),
		"+};"
	];
	return [...block("light"), ...block("dark")].join("\n");
}

const workbenchPatch = `+<meta name="theme-color" content="#111111" media="(prefers-color-scheme: light)">
+<meta name="theme-color" content="#222222" media="(prefers-color-scheme: dark)">
+ html, body { background-color: #333333; }
+ @media (prefers-color-scheme: dark) { html, body { background-color: #444444; } }
+ html[data-scheme="light"], html[data-scheme="light"] body { background-color: #555555; }
+ html[data-scheme="dark"], html[data-scheme="dark"] body { background-color: #666666; }
+theme_color: "#777777"
+background_color: "#888888"`;

const host = vi.hoisted<{
	config: unknown;
	writes: Array<{ path: string; contents: string }>;
}>(() => ({
	config: null,
	writes: []
}));

vi.mock("node:fs/promises", () => ({
	readFile: (path: string) => {
		const normalized = path.replaceAll("\\", "/");
		if (normalized.endsWith("/packages/shared/theme.json"))
			return Promise.resolve(JSON.stringify(host.config));
		if (normalized.endsWith("/themes/light_modern.json"))
			return Promise.resolve(JSON.stringify(upstreamTheme()));
		if (normalized.endsWith("/themes/dark_modern.json"))
			return Promise.resolve(JSON.stringify(upstreamTheme()));
		if (normalized.endsWith("/themes/base.json"))
			return Promise.resolve(
				JSON.stringify({
					colors: Object.fromEntries(
						firstPaintKeys.map((key) => [key, "#010101"])
					),
					semanticTokenColors: { inheritedComment: "#010101" },
					tokenColors: []
				})
			);
		if (normalized.endsWith("/patches/first-paint.diff"))
			return Promise.resolve(firstPaintPatch());
		if (normalized.endsWith("/patches/workbench-page.diff"))
			return Promise.resolve(workbenchPatch);
		return Promise.resolve(null);
	},
	readdir: () =>
		Promise.resolve(["README.md", "first-paint.diff", "workbench-page.diff"]),
	writeFile: (path: string, contents: string) => {
		host.writes.push({ path, contents });
		return Promise.resolve();
	}
}));

vi.mock("../../../../../scripts/write-formatted.mjs", () => ({
	formatContent: (_path: string, contents: string) => Promise.resolve(contents)
}));

const slash = (path: string) => path.replaceAll("\\", "/");

async function generate(check = false) {
	host.writes.length = 0;
	const argv = process.argv;
	process.argv = check
		? [...argv, "--check"]
		: argv.filter((v) => v !== "--check");
	vi.resetModules();
	try {
		// @ts-expect-error The behavior-tested JavaScript entry point has no declaration file.
		await import("../../../scripts/theme.mjs");
	} finally {
		process.argv = argv;
	}
}

function generated(scheme: "light" | "dark") {
	const entry = host.writes.find(({ path }) =>
		slash(path).endsWith(`/themes/composery-${scheme}.json`)
	);
	expect(entry).not.toBeUndefined();
	return JSON.parse(entry?.contents ?? "null") as {
		tokenColors: Array<{
			settings: { foreground?: string; fontStyle?: string };
		}>;
		semanticTokenColors: unknown;
	};
}

beforeEach(() => {
	host.config = { web: structuredClone(theme), ide: structuredClone(ideTheme) };
});

describe("theme generator", () => {
	test("retints inherited VS Code chrome, syntax, semantics, and status colors", async () => {
		await generate();

		const light = generated("light");
		const dark = generated("dark");
		expect(light).toMatchObject({
			$schema: "vscode://schemas/color-theme",
			name: "Composery Light",
			type: "light",
			semanticHighlighting: true,
			colors: {
				"child.color": "#020202",
				"editor.background": "#ffffff",
				"editor.foreground": "#000000",
				"activityBar.background": "#ffffff",
				"activityBar.inactiveForeground": "#737373",
				"activityBarBadge.background": "#171717",
				"activityBarBadge.foreground": "#fafafa",
				"editorWidget.background": "#f5f5f5",
				"editorGroupHeader.tabsBackground": "#f5f5f5",
				"tab.activeBackground": "#f5f5f5",
				"tab.inactiveForeground": "#737373",
				"input.background": "#f5f5f5",
				"input.border": "#e5e5e5",
				"button.background": "#171717",
				"button.foreground": "#fafafa",
				"list.hoverBackground": "#f5f5f5",
				"editor.selectionBackground": "#00000029",
				"editor.findMatchBackground": "#dc8a0666",
				"editor.findMatchHighlightBackground": "#dc8a0633",
				"editorBracketMatch.background": "#ffffff00",
				"scrollbarSlider.background": "#00000033",
				"editorLink.activeForeground": "#2563eb",
				"gitDecoration.addedResourceForeground": "#16a34a",
				"editorWarning.foreground": "#dc8a06",
				"editorError.foreground": "#dc2626",
				"editorInfo.foreground": "#2563eb",
				"editorGutter.addedBackground": "#16a34a",
				"diffEditor.insertedLineBackground": "#16a34a1f",
				"diffEditorOverview.insertedForeground": "#16a34a80",
				"terminal.ansiRed": "#dc2626",
				"terminal.ansiGreen": "#16a34a",
				"terminal.ansiYellow": "#dc8a06",
				"terminal.ansiBlue": "#2563eb",
				"terminal.ansiBrightWhite": "#e5e5e5"
			}
		});
		expect(dark).toMatchObject({
			name: "Composery Dark",
			type: "dark",
			colors: {
				"editor.background": "#0a0a0a",
				"editor.foreground": "#fafafa",
				"activityBar.background": "#0a0a0a",
				"button.background": "#fafafa",
				"button.foreground": "#0a0a0a",
				"editor.findMatchBackground": "#f5a80b66",
				"editorBracketMatch.background": "#0a0a0a00",
				"gitDecoration.addedResourceForeground": "#22c55e",
				"editorWarning.foreground": "#f5a80b",
				"editorError.foreground": "#f87171",
				"editorInfo.foreground": "#60a5fa",
				"diffEditorOverview.removedForeground": "#f8717180"
			}
		});

		expect(
			light.tokenColors.map(
				(rule: { settings: { foreground?: string; fontStyle?: string } }) =>
					rule.settings.foreground ?? rule.settings.fontStyle
			)
		).toEqual([
			"#008000",
			"#a31515",
			"#a31515",
			"#a31515",
			"#795e26",
			"#795e26",
			"#267f99",
			"#267f99",
			"#267f99",
			"#098658",
			"#0000ff",
			"#0000ff",
			"#001080",
			"#001080",
			"#001080",
			"#001080",
			"#001080",
			"#001080",
			"#000000",
			"#16a34a",
			"#dc2626",
			"#dc8a06",
			"#dc2626",
			"#010101",
			"bold"
		]);
		expect(light.semanticTokenColors).toEqual({
			inheritedComment: "#008000",
			comment: "#008000",
			regexpToken: { foreground: "#a31515", bold: true },
			stringToken: "#a31515",
			numberToken: { foreground: "#098658", bold: true },
			decoratorToken: "#795e26",
			namespaceToken: { foreground: "#267f99", bold: true },
			labelToken: "#001080",
			functionToken: { foreground: "#795e26", bold: true },
			methodToken: "#795e26",
			customLiteralToken: { foreground: "#795e26", bold: true },
			classToken: "#267f99",
			enumToken: { foreground: "#267f99", bold: true },
			interfaceToken: "#267f99",
			structToken: { foreground: "#267f99", bold: true },
			typeToken: "#267f99",
			operatorToken: { foreground: "#0000ff", bold: true },
			keywordToken: "#0000ff",
			parameterToken: { foreground: "#001080", bold: true },
			propertyToken: "#001080",
			variableToken: { foreground: "#001080", bold: true },
			unknownToken: "#010101"
		});
	});

	test("updates committed TypeScript and patch literals from the generated themes", async () => {
		await generate();

		const themeSource = host.writes.find(({ path }) =>
			slash(path).endsWith("/packages/shared/theme.ts")
		);
		expect(themeSource?.contents).toContain(
			`export const theme = ${JSON.stringify(theme, null, "\t")} as const;`
		);
		expect(themeSource?.contents).toContain(
			`export const ideTheme = ${JSON.stringify(ideTheme, null, "\t")} as const;`
		);

		const firstPaint = host.writes.find(({ path }) =>
			slash(path).endsWith("/patches/first-paint.diff")
		)?.contents;
		expect(firstPaint).toContain("+\t'editor.background': '#ffffff',");
		expect(firstPaint).toContain("+\t'editor.background': '#0a0a0a',");
		expect(firstPaint).toContain(
			"+\t'activityBarBadge.background': '#171717',"
		);
		expect(firstPaint).toContain(
			"+\t'activityBarBadge.background': '#fafafa',"
		);
		expect(firstPaint).toContain("+\t'button.border': '#010101',");

		const workbench = host.writes.find(({ path }) =>
			slash(path).endsWith("/patches/workbench-page.diff")
		)?.contents;
		expect(workbench)
			.toBe(`+<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
+<meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)">
+ html, body { background-color: #ffffff; }
+ @media (prefers-color-scheme: dark) { html, body { background-color: #0a0a0a; } }
+ html[data-scheme="light"], html[data-scheme="light"] body { background-color: #ffffff; }
+ html[data-scheme="dark"], html[data-scheme="dark"] body { background-color: #0a0a0a; }
+theme_color: "#0a0a0a"
+background_color: "#0a0a0a"`);
	});

	test("rejects an invalid palette before emitting partial outputs", async () => {
		const config = structuredClone(host.config) as {
			web: { light: { background: string; foreground: string } };
		};
		config.web.light.foreground = config.web.light.background;
		host.config = config;

		await expect(generate()).rejects.toThrow(
			"light page text must have 4.5:1 contrast"
		);
		expect(host.writes).toEqual([]);
	});

	test("check mode reports stale generated files without replacing them", async () => {
		await expect(generate(true)).rejects.toThrow(
			"Theme outputs are stale; run `pnpm assets`"
		);
		expect(host.writes).toEqual([]);
	});
});
