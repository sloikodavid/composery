import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { formatContent } from "../../../scripts/write-formatted.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const configPath = join(root, "packages", "shared", "theme.json");
const themeSourcePath = join(root, "packages", "shared", "theme.ts");
const upstreamThemes = join(
	root,
	"packages",
	"ide",
	"upstream",
	"lib",
	"vscode",
	"extensions",
	"theme-defaults",
	"themes"
);
const outputThemes = join(
	root,
	"packages",
	"ide",
	"overlay",
	"lib",
	"vscode",
	"extensions",
	"composery-themes",
	"themes"
);
const check = process.argv.includes("--check");
const stale = [];

async function emit(path, contents) {
	const formatted = await formatContent(path, contents);
	await emitRaw(path, formatted);
}

async function emitRaw(path, contents) {
	if (check) {
		if ((await readFile(path, "utf8").catch(() => null)) !== contents)
			stale.push(relative(root, path));
		return;
	}
	await writeFile(path, contents, "utf8");
}

function parseJsonc(path, source) {
	const result = ts.parseConfigFileTextToJson(path, source);
	if (result.error)
		throw new Error(
			ts.flattenDiagnosticMessageText(result.error.messageText, "\n")
		);
	return result.config;
}

async function flatten(file) {
	const path = join(upstreamThemes, file);
	const current = parseJsonc(path, await readFile(path, "utf8"));
	const parent = current.include
		? await flatten(current.include.replace("./", ""))
		: {};
	return {
		...parent,
		...current,
		colors: { ...parent.colors, ...current.colors },
		semanticTokenColors: {
			...parent.semanticTokenColors,
			...current.semanticTokenColors
		},
		tokenColors: [...(parent.tokenColors ?? []), ...(current.tokenColors ?? [])]
	};
}

const appendAlpha = (color, alpha) => color.slice(0, 7) + alpha;
const transparent = "#00000000";

function set(colors, keys, value) {
	for (const key of keys) colors[key] = value;
}

function luminance(color) {
	const channels = color
		.slice(1, 7)
		.match(/../g)
		.map((part) => {
			const channel = Number.parseInt(part, 16) / 255;
			return channel <= 0.03928
				? channel / 12.92
				: ((channel + 0.055) / 1.055) ** 2.4;
		});
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first, second) {
	const a = luminance(first);
	const b = luminance(second);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function syntaxRole(scopes) {
	const matches = (pattern) => scopes.some((scope) => pattern.test(scope));
	if (matches(/^comment/)) return "comment";
	if (matches(/^constant\.character\.escape/)) return "escape";
	if (matches(/^.*regexp|^.*regex/)) return "regex";
	if (matches(/^(string|markup\.inline\.raw)/)) return "string";
	if (matches(/^(entity\.name\.function\.decorator|meta\.decorator)/))
		return "decorator";
	if (
		matches(
			/^(entity\.name\.function|support\.function|meta\.function-call|entity\.name\.method)/
		)
	)
		return "function";
	if (matches(/^entity\.name\.namespace/)) return "namespace";
	if (matches(/^(entity\.name\.tag|entity\.name\.selector)/)) return "tag";
	if (
		matches(
			/^(support\.class|entity\.name\.type|support\.type|meta\.type|storage\.type)/
		)
	)
		return "type";
	if (matches(/^(constant\.numeric|keyword\.other\.unit)/)) return "number";
	if (matches(/^keyword\.operator/)) return "operator";
	if (
		matches(
			/^(keyword|storage\.modifier|constant\.language|modifier|meta\.preprocessor)/
		)
	)
		return "keyword";
	if (matches(/^variable\.parameter/)) return "parameter";
	if (
		matches(
			/^(meta\.object-literal|.*dictionary\.key|variable\.other\.property|support\.variable\.property)/
		)
	)
		return "property";
	if (matches(/^entity\.other\.attribute-name/)) return "attribute";
	if (matches(/^entity\.name\.label/)) return "label";
	if (matches(/^(support\.constant|constant\.other)/)) return "constant";
	if (matches(/^variable/)) return "variable";
	if (
		matches(
			/^(punctuation|meta\.embedded|meta\.template|source\.groovy\.embedded)/
		)
	)
		return "punctuation";
	return null;
}

function semanticRole(key) {
	const name = key.toLowerCase();
	if (name.includes("comment")) return "comment";
	if (name.includes("regexp")) return "regex";
	if (name.includes("string")) return "string";
	if (name.includes("number")) return "number";
	if (name.includes("decorator")) return "decorator";
	if (name.includes("namespace")) return "namespace";
	if (name.includes("label")) return "label";
	if (
		name.includes("function") ||
		name.includes("method") ||
		name.includes("customliteral")
	)
		return "function";
	if (
		name.includes("class") ||
		name.includes("enum") ||
		name.includes("interface") ||
		name.includes("struct") ||
		name.includes("type")
	)
		return "type";
	if (name.includes("operator")) return "operator";
	if (name.includes("keyword")) return "keyword";
	if (name.includes("parameter")) return "parameter";
	if (name.includes("property")) return "property";
	if (name.includes("variable")) return "variable";
	return null;
}

function retint(base, web, ide, features, scheme) {
	const colors = { ...base.colors };

	set(
		colors,
		["titleBar.activeBackground", "titleBar.inactiveBackground"],
		ide.titleBar
	);
	set(
		colors,
		["activityBar.background", "activityBarTop.background"],
		ide.activityBar
	);
	set(
		colors,
		["sideBar.background", "sideBarSectionHeader.background"],
		ide.sideBar
	);
	set(colors, ["panel.background"], ide.panel);
	set(
		colors,
		["statusBar.background", "statusBar.noFolderBackground"],
		ide.statusBar
	);
	set(colors, ["breadcrumb.background"], ide.breadcrumb);
	set(colors, ["editor.background", "terminal.background"], ide.editor);
	set(
		colors,
		[
			"editorWidget.background",
			"menu.background",
			"notificationCenterHeader.background",
			"notifications.background",
			"peekViewEditor.background",
			"peekViewResult.background",
			"peekViewTitle.background",
			"quickInput.background",
			"textBlockQuote.background",
			"textCodeBlock.background",
			"welcomePage.tileBackground"
		],
		ide.widget
	);
	set(colors, ["editorGroupHeader.tabsBackground"], ide.tabBar);
	set(
		colors,
		["tab.activeBackground", "tab.unfocusedActiveBackground"],
		ide.tabActive
	);
	set(
		colors,
		["tab.inactiveBackground", "tab.unfocusedInactiveBackground"],
		ide.tabInactive
	);
	set(colors, ["checkbox.background", "input.background"], ide.inputBackground);
	set(colors, ["dropdown.background"], ide.dropdown);
	set(colors, ["badge.background"], ide.badge);
	set(colors, ["badge.foreground"], ide.badgeForeground);
	set(
		colors,
		["actionBar.toggledBackground", "button.secondaryBackground"],
		ide.secondaryButton
	);
	set(colors, ["button.secondaryForeground"], ide.secondaryButtonForeground);
	set(
		colors,
		["button.secondaryHoverBackground", "statusBarItem.compactHoverBackground"],
		ide.secondaryButtonHover
	);
	set(colors, ["button.background"], ide.button);
	set(colors, ["button.foreground"], ide.buttonForeground);
	set(colors, ["button.hoverBackground"], ide.buttonHover);
	set(
		colors,
		[
			"list.activeSelectionIconForeground",
			"panelTitle.activeBorder",
			"progressBar.background",
			"tab.activeBorderTop",
			"tab.selectedBorderTop",
			"terminal.tab.activeBorder"
		],
		ide.focus
	);
	set(
		colors,
		["activityBarBadge.background", "statusBarItem.remoteBackground"],
		ide.badge
	);
	set(
		colors,
		[
			"activityBar.foreground",
			"editor.foreground",
			"foreground",
			"icon.foreground",
			"sideBar.foreground",
			"sideBarSectionHeader.foreground",
			"terminal.foreground"
		],
		ide.foreground
	);
	set(
		colors,
		[
			"dropdown.foreground",
			"input.foreground",
			"keybindingLabel.foreground",
			"menu.foreground",
			"notificationCenterHeader.foreground",
			"notifications.foreground",
			"panelTitle.activeForeground",
			"quickInput.foreground"
		],
		ide.inputForeground
	);
	set(colors, ["dropdown.foreground"], ide.dropdownForeground);
	set(colors, ["titleBar.activeForeground"], ide.titleBarForeground);
	set(colors, ["statusBarItem.remoteForeground"], ide.badgeForeground);
	set(colors, ["activityBarBadge.foreground"], ide.badgeForeground);
	set(
		colors,
		[
			"descriptionForeground",
			"panelTitle.inactiveForeground",
			"sideBarTitle.foreground",
			"welcomePage.progress.foreground"
		],
		ide.mutedForeground
	);
	set(colors, ["activityBar.inactiveForeground"], ide.activityBarInactive);
	set(colors, ["statusBar.foreground"], ide.statusBarForeground);
	set(colors, ["breadcrumb.foreground"], ide.breadcrumbForeground);
	set(colors, ["tab.activeForeground"], ide.tabActiveForeground);
	set(
		colors,
		[
			"tab.inactiveForeground",
			"tab.unfocusedInactiveForeground",
			"titleBar.inactiveForeground"
		],
		ide.tabInactiveForeground
	);
	set(colors, ["input.placeholderForeground"], ide.placeholder);
	set(colors, ["list.hoverBackground"], ide.listHover);
	set(
		colors,
		[
			"editor.inactiveSelectionBackground",
			"editorSuggestWidget.selectedBackground",
			"list.activeSelectionBackground",
			"list.inactiveSelectionBackground",
			"quickInputList.focusBackground",
			"tab.selectedBackground"
		],
		ide.listSelection
	);
	set(
		colors,
		[
			"inputOption.activeForeground",
			"list.activeSelectionForeground",
			"menu.selectionForeground"
		],
		ide.listSelectionForeground
	);
	set(
		colors,
		["tab.hoverBackground", "tab.unfocusedHoverBackground"],
		ide.tabHover
	);
	set(colors, ["tab.selectedForeground"], ide.tabActiveForeground);
	set(colors, ["menu.selectionBackground"], ide.listSelection);
	set(colors, ["list.dropBackground"], ide.dropBackground);
	set(
		colors,
		[
			"activityBar.border",
			"agentsPanel.border",
			"diffEditor.border",
			"editorGroup.border",
			"editorOverviewRuler.border",
			"editorStickyScroll.border",
			"editorHoverWidget.border",
			"editorSuggestWidget.border",
			"editorWidget.border",
			"gauge.border",
			"inlineChat.border",
			"menu.border",
			"notificationCenter.border",
			"notificationToast.border",
			"notifications.border",
			"panel.border",
			"peekView.border",
			"pickerGroup.border",
			"quickInput.border",
			"sideBar.border",
			"sideBarSectionHeader.border",
			"statusBar.border",
			"terminal.border",
			"textBlockQuote.border",
			"titleBar.border",
			"widget.border"
		],
		features.surfaceBorders ? ide.border : transparent
	);
	set(
		colors,
		[
			"agentsChatInput.border",
			"agentsNewSessionButton.border",
			"button.border",
			"button.secondaryBorder",
			"checkbox.border",
			"commandCenter.border",
			"dropdown.border",
			"input.border",
			"panelInput.border",
			"searchEditor.textInputBorder",
			"settings.dropdownBorder",
			"settings.numberInputBorder",
			"settings.textInputBorder"
		],
		features.controlBorders ? ide.inputBorder : transparent
	);
	set(
		colors,
		["editorGroupHeader.tabsBorder", "tab.border", "tab.lastPinnedBorder"],
		features.tabBorders ? ide.tabBorder : transparent
	);
	set(colors, ["tab.activeBorder", "tab.unfocusedActiveBorder"], transparent);
	set(
		colors,
		[
			"tab.activeBorderTop",
			"tab.unfocusedActiveBorderTop",
			"terminal.tab.activeBorder"
		],
		features.activeTabIndicator ? ide.focus : transparent
	);
	set(
		colors,
		[
			"activityBar.activeBorder",
			"activityBar.activeFocusBorder",
			"activityBarTop.activeBorder"
		],
		features.activityBarIndicator ? ide.focus : transparent
	);
	colors["panelTitle.activeBorder"] = features.panelTitleIndicator
		? ide.focus
		: transparent;
	colors.contrastBorder = features.contrastBorders ? ide.border : transparent;
	colors.contrastActiveBorder = features.contrastBorders
		? ide.focus
		: transparent;
	set(
		colors,
		[
			"focusBorder",
			"agentsChatInput.focusBorder",
			"inputOption.activeBorder",
			"list.focusOutline",
			"statusBar.focusBorder",
			"statusBarItem.focusBorder"
		],
		ide.focus
	);
	set(
		colors,
		[
			"editorStickyScroll.shadow",
			"listFilterWidget.shadow",
			"panelStickyScroll.shadow",
			"scrollbar.shadow",
			"sideBarStickyScroll.shadow",
			"widget.shadow"
		],
		features.shadows ? ide.shadow : transparent
	);
	colors["editorLineNumber.foreground"] = ide.lineNumber;
	colors["editorLineNumber.activeForeground"] = ide.activeLineNumber;
	colors["gitDecoration.ignoredResourceForeground"] = ide.ignored;
	set(
		colors,
		[
			"editorSuggestWidget.background",
			"diffEditor.unchangedRegionBackground",
			"dropdown.listBackground",
			"settings.dropdownBackground"
		],
		ide.widget
	);
	set(
		colors,
		["notebook.cellBorderColor", "menu.separatorBackground"],
		ide.separator
	);
	set(colors, ["notebook.selectedCellBackground"], ide.listSelection);
	set(
		colors,
		["list.focusAndSelectionOutline", "inputOption.activeBorder"],
		ide.focus
	);
	set(colors, ["inputOption.activeBackground"], ide.listSelection);
	set(colors, ["pickerGroup.foreground"], ide.mutedForeground);
	set(colors, ["settings.headerForeground"], ide.settingsHeader);
	set(colors, ["settings.modifiedItemIndicator"], ide.settingsModified);
	set(
		colors,
		[
			"peekViewEditor.matchHighlightBackground",
			"peekViewResult.matchHighlightBackground"
		],
		ide.findMatchHighlight
	);
	set(
		colors,
		["statusBarItem.hoverBackground", "statusBarItem.prominentBackground"],
		ide.listHover
	);
	set(colors, ["statusBarItem.hoverForeground"], ide.foreground);
	set(colors, ["statusBarItem.errorBackground"], web.destructive);
	set(colors, ["debugToolBar.background"], ide.debugToolbar);
	set(colors, ["statusBar.debuggingBackground"], ide.debugStatus);
	set(colors, ["statusBar.debuggingForeground"], ide.debugStatusForeground);
	set(colors, ["chat.slashCommandBackground"], ide.chatAccent);
	set(colors, ["chat.slashCommandForeground"], ide.chatAccentForeground);
	set(colors, ["chat.editedFileForeground"], ide.chatEdited);
	set(colors, ["textPreformat.background"], ide.preformatted);
	set(colors, ["textPreformat.foreground"], ide.preformattedForeground);
	set(colors, ["textSeparator.foreground"], ide.separator);

	set(
		colors,
		[
			"editor.selectionBackground",
			"selection.background",
			"terminal.selectionBackground"
		],
		ide.selection
	);
	set(
		colors,
		[
			"editor.selectionHighlightBackground",
			"terminal.inactiveSelectionBackground"
		],
		ide.selectionHighlight
	);
	set(
		colors,
		["editor.wordHighlightBackground", "editor.wordHighlightStrongBackground"],
		ide.wordHighlight
	);
	set(
		colors,
		["editorCursor.foreground", "terminalCursor.foreground"],
		ide.cursor
	);
	set(
		colors,
		["editor.findMatchBackground", "terminal.findMatchBackground"],
		appendAlpha(ide.findMatch, "66")
	);
	set(
		colors,
		[
			"editor.findMatchHighlightBackground",
			"editor.findRangeHighlightBackground",
			"terminal.findMatchHighlightBackground"
		],
		ide.findMatchHighlight
	);
	set(
		colors,
		["editorIndentGuide.background1", "tree.indentGuidesStroke"],
		ide.indentGuide
	);
	set(colors, ["editorIndentGuide.activeBackground1"], ide.activeIndentGuide);
	set(colors, ["editorWhitespace.foreground"], ide.whitespace);
	set(colors, ["editorRuler.foreground"], ide.ruler);
	set(colors, ["editorBracketMatch.border"], ide.bracketMatch);
	colors["editorBracketMatch.background"] = appendAlpha(ide.editor, "00");
	set(colors, ["scrollbarSlider.background"], ide.scrollbar);
	set(colors, ["scrollbarSlider.hoverBackground"], ide.scrollbarHover);
	set(colors, ["scrollbarSlider.activeBackground"], ide.scrollbarActive);
	set(
		colors,
		[
			"editorLink.activeForeground",
			"textLink.activeForeground",
			"textLink.foreground",
			"welcomePage.progress.background"
		],
		ide.link
	);

	const statuses = {
		success: [
			"gitDecoration.addedResourceForeground",
			"gitDecoration.untrackedResourceForeground",
			"ports.iconRunningProcessForeground"
		],
		warning: [
			"editorWarning.foreground",
			"gitDecoration.conflictingResourceForeground",
			"gitDecoration.modifiedResourceForeground",
			"gitDecoration.stageModifiedResourceForeground",
			"problemsWarningIcon.foreground"
		],
		destructive: [
			"editorError.foreground",
			"errorForeground",
			"gitDecoration.deletedResourceForeground",
			"gitDecoration.stageDeletedResourceForeground",
			"problemsErrorIcon.foreground"
		],
		info: [
			"editorInfo.foreground",
			"notificationsInfoIcon.foreground",
			"problemsInfoIcon.foreground"
		]
	};
	for (const [role, keys] of Object.entries(statuses))
		set(colors, keys, web[role]);

	set(colors, ["editorGutter.addedBackground"], ide.gutterAdded);
	set(colors, ["editorGutter.modifiedBackground"], ide.gutterModified);
	set(colors, ["editorGutter.deletedBackground"], ide.gutterDeleted);
	set(
		colors,
		[
			"diffEditor.insertedLineBackground",
			"diffEditor.insertedTextBackground",
			"diffEditorGutter.insertedLineBackground"
		],
		ide.diffInserted
	);
	set(
		colors,
		[
			"diffEditor.removedLineBackground",
			"diffEditor.removedTextBackground",
			"diffEditorGutter.removedLineBackground"
		],
		ide.diffRemoved
	);
	colors["diffEditorOverview.insertedForeground"] = appendAlpha(
		ide.gutterAdded,
		"80"
	);
	colors["diffEditorOverview.removedForeground"] = appendAlpha(
		ide.gutterDeleted,
		"80"
	);

	for (const [ansi, role] of [
		["Red", "destructive"],
		["Green", "success"],
		["Yellow", "warning"],
		["Blue", "info"]
	])
		colors[`terminal.ansi${ansi}`] = web[role];
	set(colors, ["terminal.ansiBlack"], ide.ansiBlack);
	set(colors, ["terminal.ansiMagenta"], ide.ansiMagenta);
	set(colors, ["terminal.ansiCyan"], ide.ansiCyan);
	set(colors, ["terminal.ansiWhite"], ide.ansiWhite);
	set(colors, ["terminal.ansiBrightBlack"], ide.ansiBrightBlack);
	set(colors, ["terminal.ansiBrightRed"], ide.ansiBrightRed);
	set(colors, ["terminal.ansiBrightGreen"], ide.ansiBrightGreen);
	set(colors, ["terminal.ansiBrightYellow"], ide.ansiBrightYellow);
	set(colors, ["terminal.ansiBrightBlue"], ide.ansiBrightBlue);
	set(colors, ["terminal.ansiBrightMagenta"], ide.ansiBrightMagenta);
	set(colors, ["terminal.ansiBrightCyan"], ide.ansiBrightCyan);
	set(colors, ["terminal.ansiBrightWhite"], ide.ansiBrightWhite);

	// Spelled out so every role is greppable; a dead role fails the wiring test.
	const syntax = {
		keyword: ide.keyword,
		operator: ide.operator,
		string: ide.string,
		escape: ide.escape,
		regex: ide.regex,
		number: ide.number,
		function: ide.function,
		decorator: ide.decorator,
		type: ide.type,
		namespace: ide.namespace,
		tag: ide.tag,
		attribute: ide.attribute,
		variable: ide.variable,
		property: ide.property,
		parameter: ide.parameter,
		constant: ide.constant,
		label: ide.label,
		punctuation: ide.punctuation,
		comment: ide.comment
	};

	const tokenColors = base.tokenColors.map((rule) => {
		const scopes = Array.isArray(rule.scope)
			? rule.scope
			: String(rule.scope ?? "")
					.split(",")
					.map((scope) => scope.trim());
		const status = scopes.some((scope) => scope.startsWith("markup.inserted"))
			? "success"
			: scopes.some((scope) => scope.startsWith("markup.deleted"))
				? "destructive"
				: scopes.some(
							(scope) =>
								scope.startsWith("markup.changed") ||
								scope.startsWith("meta.diff")
					  )
					? "warning"
					: scopes.some((scope) => scope.startsWith("invalid"))
						? "destructive"
						: null;
		const role = syntaxRole(scopes);
		const foreground = status ? web[status] : role ? syntax[role] : null;
		if (!role && !foreground) return rule;
		const settings = { ...rule.settings };
		if (foreground && settings.foreground) settings.foreground = foreground;
		return { ...rule, settings };
	});
	const semanticTokenColors = Object.fromEntries(
		Object.entries(base.semanticTokenColors).map(([key, value]) => {
			const role = semanticRole(key);
			if (!role) return [key, value];
			return [
				key,
				typeof value === "string"
					? syntax[role]
					: { ...value, foreground: syntax[role] }
			];
		})
	);

	return {
		$schema: "vscode://schemas/color-theme",
		name: `Composery ${scheme === "dark" ? "Dark" : "Light"}`,
		type: scheme,
		"//": "Generated from VS Code Modern. Product chrome and syntax follow packages/shared/theme.json; diagnostics, Git, diff, and ANSI status colours share the web status roles.",
		semanticHighlighting: features.semanticHighlighting,
		colors,
		semanticTokenColors,
		tokenColors
	};
}

const config = JSON.parse(await readFile(configPath, "utf8"));
const webTheme = config.web;
const ideFeatures = config.ide.features;
const ideTheme = { light: config.ide.light, dark: config.ide.dark };
const featureNames = [
	"surfaceBorders",
	"controlBorders",
	"tabBorders",
	"shadows",
	"activeTabIndicator",
	"activityBarIndicator",
	"panelTitleIndicator",
	"contrastBorders",
	"semanticHighlighting"
];
const isPalette = (palette) =>
	palette &&
	Object.values(palette).every(
		(value) =>
			typeof value === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)
	);
const sameKeys = (first, second) =>
	Object.keys(first).length === Object.keys(second).length &&
	Object.keys(first).every((key) => Object.hasOwn(second, key));
if (
	!sameKeys(config, { web: true, ide: true }) ||
	!sameKeys(webTheme, { light: true, dark: true }) ||
	!sameKeys(config.ide, { features: true, light: true, dark: true }) ||
	!sameKeys(webTheme.light, webTheme.dark) ||
	!sameKeys(ideTheme.light, ideTheme.dark) ||
	!isPalette(webTheme.light) ||
	!isPalette(webTheme.dark) ||
	!isPalette(ideTheme.light) ||
	!isPalette(ideTheme.dark) ||
	!sameKeys(
		ideFeatures,
		Object.fromEntries(featureNames.map((name) => [name, true]))
	) ||
	Object.values(ideFeatures).some((value) => typeof value !== "boolean")
)
	throw new Error(
		"theme.json must define matching light/dark web and IDE hex colours plus the supported IDE boolean features"
	);

for (const scheme of ["light", "dark"]) {
	const colors = webTheme[scheme];
	if (
		new Set([colors.success, colors.warning, colors.destructive, colors.info])
			.size !== 4
	)
		throw new Error(`${scheme} status colours must be distinct`);
	for (const [name, foreground, background] of [
		["page text", colors.foreground, colors.background],
		["muted page text", colors.mutedForeground, colors.background],
		["card text", colors.cardForeground, colors.card],
		["muted card text", colors.mutedForeground, colors.card],
		["popover text", colors.popoverForeground, colors.popover],
		["button text", colors.buttonForeground, colors.button],
		[
			"primary button text",
			colors.primaryButtonForeground,
			colors.primaryButton
		],
		[
			"secondary button text",
			colors.secondaryButtonForeground,
			colors.secondaryButton
		],
		["badge text", colors.badgeForeground, colors.badge],
		["field text", colors.fieldForeground, colors.field],
		["selected item text", colors.selectedForeground, colors.selected],
		["dialog text", colors.dialogForeground, colors.dialog]
	])
		if (contrast(foreground, background) < 4.5)
			throw new Error(`${scheme} ${name} must have 4.5:1 contrast`);
}

await emit(
	themeSourcePath,
	`// AUTO-GENERATED by packages/shared/scripts/theme.mjs from theme.json.
// Edit the theme with \`pnpm dev:colors\` or edit theme.json directly.
export const theme = ${JSON.stringify(webTheme, null, "\t")} as const;
export const ideTheme = ${JSON.stringify(ideTheme, null, "\t")} as const;
export const ideFeatures = ${JSON.stringify(ideFeatures, null, "\t")} as const;
`
);

const generatedThemes = {};
for (const scheme of ["light", "dark"]) {
	const modern = await flatten(`${scheme}_modern.json`);
	delete modern.include;
	generatedThemes[scheme] = retint(
		modern,
		webTheme[scheme],
		ideTheme[scheme],
		ideFeatures,
		scheme
	);
	await emit(
		join(outputThemes, `composery-${scheme}.json`),
		`${JSON.stringify(generatedThemes[scheme], null, "\t")}\n`
	);
}

const patchDirectory = join(root, "packages", "ide", "patches");
const patchNames = await readdir(patchDirectory);
const firstPaintPatches = [];
const workbenchPagePatches = [];
for (const name of patchNames) {
	if (!name.endsWith(".diff")) continue;
	const source = await readFile(join(patchDirectory, name), "utf8");
	if (
		source.includes("COLOR_THEME_DARK_INITIAL_COLORS") ||
		source.includes("COLOR_THEME_LIGHT_INITIAL_COLORS")
	)
		firstPaintPatches.push({ name, source });
	if (
		source.includes('meta name="theme-color"') &&
		source.includes("theme_color:")
	)
		workbenchPagePatches.push({ name, source });
}
if (firstPaintPatches.length !== 1)
	throw new Error(
		`expected one first-paint patch, found ${firstPaintPatches.length}`
	);

const firstPaint = firstPaintPatches[0];
const firstPaintLines = [];
let activeScheme = null;
let compared = 0;
for (const line of firstPaint.source.split("\n")) {
	if (line.includes("COLOR_THEME_DARK_INITIAL_COLORS")) activeScheme = "dark";
	else if (line.includes("COLOR_THEME_LIGHT_INITIAL_COLORS"))
		activeScheme = "light";
	else if (activeScheme && /^[ +]};$/.test(line)) activeScheme = null;

	const match =
		activeScheme && line.match(/^([ +])(\t'([^']+)': ')([^']*)(',?)$/);
	if (!match) {
		firstPaintLines.push(line);
		continue;
	}
	const [, sign, head, key, current, tail] = match;
	const wanted = generatedThemes[activeScheme].colors[key];
	if (!wanted) {
		firstPaintLines.push(line);
		continue;
	}
	compared++;
	if (wanted.toLowerCase() === current.toLowerCase()) {
		firstPaintLines.push(line);
		continue;
	}
	if (sign === "+") firstPaintLines.push(`+${head}${wanted}${tail}`);
	else
		firstPaintLines.push(
			`-${head}${current}${tail}`,
			`+${head}${wanted}${tail}`
		);
}
if (compared < 100)
	throw new Error(`first-paint patch exposed only ${compared} theme colours`);
await emitRaw(
	join(patchDirectory, firstPaint.name),
	firstPaintLines.join("\n")
);

if (workbenchPagePatches.length !== 1)
	throw new Error(
		`expected one workbench-page patch, found ${workbenchPagePatches.length}`
	);
const workbenchPage = workbenchPagePatches[0];
const workbenchPagePath = join(patchDirectory, workbenchPage.name);
let workbenchPageSource = workbenchPage.source;
for (const [name, pattern, value] of [
	[
		"light theme-color",
		/(<meta name="theme-color" content=")#[0-9a-f]{6}(" media="\(prefers-color-scheme: light\)")/i,
		ideTheme.light.titleBar
	],
	[
		"dark theme-color",
		/(<meta name="theme-color" content=")#[0-9a-f]{6}(" media="\(prefers-color-scheme: dark\)")/i,
		ideTheme.dark.titleBar
	],
	[
		"light first paint",
		/^(\+\s*html, body \{ background-color: )#[0-9a-f]{6}(; \})$/im,
		ideTheme.light.editor
	],
	[
		"dark first paint",
		/^(\+\s*@media \(prefers-color-scheme: dark\) \{ html, body \{ background-color: )#[0-9a-f]{6}(; \} \})$/im,
		ideTheme.dark.editor
	],
	[
		"manifest theme",
		/(theme_color: ")#[0-9a-f]{6}(")/i,
		ideTheme.dark.titleBar
	],
	[
		"manifest background",
		/(background_color: ")#[0-9a-f]{6}(")/i,
		ideTheme.dark.editor
	]
]) {
	const matches =
		workbenchPageSource.match(
			new RegExp(
				pattern.source,
				pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`
			)
		) ?? [];
	if (matches.length !== 1)
		throw new Error(
			`${name}: expected one patch literal, found ${matches.length}`
		);
	workbenchPageSource = workbenchPageSource.replace(pattern, `$1${value}$2`);
}
await emitRaw(workbenchPagePath, workbenchPageSource);

if (check && stale.length)
	throw new Error(
		`Theme outputs are stale; run \`pnpm fix:assets\`:\n${stale
			.map((path) => `  ${path}`)
			.join("\n")}`
	);
