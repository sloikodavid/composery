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
	if (
		matches(
			/^(string|.*regexp|.*regex|constant\.character\.escape|markup\.inline\.raw)/
		)
	)
		return "string";
	if (
		matches(
			/^(entity\.name\.function|support\.function|meta\.function-call|entity\.name\.method)/
		)
	)
		return "function";
	if (
		matches(
			/^(entity\.name\.tag|entity\.name\.selector|support\.class|entity\.name\.type|support\.type|meta\.type|entity\.name\.namespace|storage\.type)/
		)
	)
		return "type";
	if (matches(/^(constant\.numeric|keyword\.other\.unit)/)) return "number";
	if (
		matches(
			/^(keyword|storage\.modifier|constant\.language|modifier|meta\.preprocessor)/
		)
	)
		return "keyword";
	if (
		matches(
			/^(variable|entity\.other\.attribute-name|meta\.object-literal|.*dictionary\.key|entity\.name\.label|support\.constant|constant\.other)/
		)
	)
		return "variable";
	if (
		matches(
			/^(punctuation|keyword\.operator|meta\.embedded|meta\.template|source\.groovy\.embedded)/
		)
	)
		return "punctuation";
	return null;
}

function semanticRole(key) {
	const name = key.toLowerCase();
	if (name.includes("comment")) return "comment";
	if (name.includes("string")) return "string";
	if (name.includes("number")) return "number";
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
	if (name.includes("keyword") || name.includes("operator")) return "keyword";
	if (
		name.includes("variable") ||
		name.includes("property") ||
		name.includes("parameter")
	)
		return "variable";
	return null;
}

function retint(base, web, ide, scheme) {
	const colors = { ...base.colors };
	const dark = scheme === "dark";

	set(
		colors,
		[
			"activityBar.background",
			"activityBarTop.background",
			"breadcrumb.background",
			"panel.background",
			"sideBar.background",
			"sideBarSectionHeader.background",
			"statusBar.background",
			"statusBar.noFolderBackground",
			"titleBar.activeBackground",
			"titleBar.inactiveBackground"
		],
		ide.chrome
	);
	set(colors, ["editor.background", "terminal.background"], ide.editor);
	set(
		colors,
		[
			"editorGroupHeader.tabsBackground",
			"editorWidget.background",
			"input.background",
			"menu.background",
			"notificationCenterHeader.background",
			"notifications.background",
			"peekViewEditor.background",
			"peekViewResult.background",
			"peekViewTitle.background",
			"quickInput.background",
			"tab.activeBackground",
			"tab.inactiveBackground",
			"tab.unfocusedActiveBackground",
			"tab.unfocusedInactiveBackground"
		],
		ide.surface
	);
	set(
		colors,
		[
			"activityBarBadge.background",
			"button.background",
			"list.activeSelectionIconForeground",
			"panelTitle.activeBorder",
			"progressBar.background",
			"statusBarItem.remoteBackground",
			"tab.activeBorderTop",
			"tab.selectedBorderTop",
			"terminal.tab.activeBorder"
		],
		ide.primary
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
			"terminal.foreground",
			"titleBar.activeForeground"
		],
		ide.foreground
	);
	set(
		colors,
		[
			"activityBarBadge.foreground",
			"button.foreground",
			"statusBarItem.remoteForeground"
		],
		ide.primaryForeground
	);
	set(
		colors,
		[
			"activityBar.inactiveForeground",
			"descriptionForeground",
			"editorLineNumber.foreground",
			"input.placeholderForeground",
			"panelTitle.inactiveForeground",
			"sideBarTitle.foreground",
			"statusBar.foreground",
			"tab.inactiveForeground",
			"titleBar.inactiveForeground",
			"welcomePage.progress.foreground"
		],
		ide.mutedForeground
	);
	set(
		colors,
		[
			"actionBar.toggledBackground",
			"badge.background",
			"button.secondaryBackground",
			"checkbox.background",
			"dropdown.background",
			"input.background",
			"textBlockQuote.background",
			"textCodeBlock.background",
			"welcomePage.tileBackground"
		],
		ide.surface
	);
	set(
		colors,
		[
			"editor.inactiveSelectionBackground",
			"editorSuggestWidget.selectedBackground",
			"list.activeSelectionBackground",
			"list.hoverBackground",
			"list.inactiveSelectionBackground",
			"quickInputList.focusBackground",
			"tab.hoverBackground",
			"tab.selectedBackground"
		],
		ide.hover
	);
	set(
		colors,
		[
			"activityBar.border",
			"checkbox.border",
			"dropdown.border",
			"editorGroup.border",
			"editorGroupHeader.tabsBorder",
			"editorOverviewRuler.border",
			"editorWidget.border",
			"input.border",
			"menu.border",
			"notifications.border",
			"panel.border",
			"panelInput.border",
			"pickerGroup.border",
			"sideBar.border",
			"sideBarSectionHeader.border",
			"tab.border",
			"titleBar.border",
			"widget.border"
		],
		ide.border
	);
	set(
		colors,
		[
			"focusBorder",
			"inputOption.activeBorder",
			"list.focusOutline",
			"statusBar.focusBorder",
			"statusBarItem.focusBorder"
		],
		ide.focus
	);
	set(colors, ["widget.shadow", "scrollbar.shadow"], ide.shadow);
	colors["editorLineNumber.foreground"] = ide.lineNumber;
	colors["gitDecoration.ignoredResourceForeground"] = ide.ignored;

	const statuses = {
		success: [
			"editorGutter.addedBackground",
			"gitDecoration.addedResourceForeground",
			"gitDecoration.untrackedResourceForeground",
			"ports.iconRunningProcessForeground"
		],
		warning: [
			"editorGutter.modifiedBackground",
			"editorWarning.foreground",
			"gitDecoration.conflictingResourceForeground",
			"gitDecoration.modifiedResourceForeground",
			"gitDecoration.stageModifiedResourceForeground",
			"problemsWarningIcon.foreground"
		],
		destructive: [
			"editorError.foreground",
			"editorGutter.deletedBackground",
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

	for (const [key, role] of [
		["diffEditor.insertedTextBackground", "success"],
		["diffEditor.insertedLineBackground", "success"],
		["diffEditorGutter.insertedLineBackground", "success"],
		["diffEditor.removedTextBackground", "destructive"],
		["diffEditor.removedLineBackground", "destructive"],
		["diffEditorGutter.removedLineBackground", "destructive"]
	])
		colors[key] = appendAlpha(web[role], dark ? "26" : "1f");
	colors["diffEditorOverview.insertedForeground"] = appendAlpha(
		web.success,
		"80"
	);
	colors["diffEditorOverview.removedForeground"] = appendAlpha(
		web.destructive,
		"80"
	);

	for (const [ansi, role] of [
		["Red", "destructive"],
		["Green", "success"],
		["Yellow", "warning"],
		["Blue", "info"]
	])
		for (const bright of ["", "Bright"])
			colors[`terminal.ansi${bright}${ansi}`] = web[role];
	for (const [ansi, role] of [
		["Black", "ansiBlack"],
		["Magenta", "ansiMagenta"],
		["Cyan", "ansiCyan"],
		["White", "ansiWhite"]
	])
		for (const bright of ["", "Bright"])
			colors[`terminal.ansi${bright}${ansi}`] = ide[role];
	colors["terminal.ansiBrightBlack"] = ide.ansiBrightBlack;

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
		const foreground = status ? web[status] : role ? ide[role] : null;
		return foreground && rule.settings?.foreground
			? {
					...rule,
					settings: { ...rule.settings, foreground }
				}
			: rule;
	});
	const semanticTokenColors = Object.fromEntries(
		Object.entries(base.semanticTokenColors).map(([key, value]) => {
			const role = semanticRole(key);
			if (!role) return [key, value];
			return [
				key,
				typeof value === "string"
					? ide[role]
					: { ...value, foreground: ide[role] }
			];
		})
	);

	return {
		$schema: "vscode://schemas/color-theme",
		name: `Composery ${scheme === "dark" ? "Dark" : "Light"}`,
		type: scheme,
		"//": "Generated from VS Code Modern. Product chrome and syntax follow packages/shared/theme.json; diagnostics, Git, diff, and ANSI status colours share the web status roles.",
		semanticHighlighting: true,
		colors,
		semanticTokenColors,
		tokenColors
	};
}

const config = JSON.parse(await readFile(configPath, "utf8"));
const webTheme = config.web;
const ideTheme = config.ide;
if (
	Object.keys(config).join() !== "web,ide" ||
	![webTheme, ideTheme].every(
		(area) =>
			Object.keys(area.light).join() === Object.keys(area.dark).join() &&
			Object.values(area).every((scheme) =>
				Object.values(scheme).every((value) =>
					/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)
				)
			)
	)
)
	throw new Error(
		"theme.json must define matching light/dark web and IDE roles as hex colours"
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
		["primary text", colors.primaryForeground, colors.primary],
		["secondary text", colors.secondaryForeground, colors.secondary]
	])
		if (contrast(foreground, background) < 4.5)
			throw new Error(`${scheme} ${name} must have 4.5:1 contrast`);
}

await emit(
	themeSourcePath,
	`// AUTO-GENERATED by packages/shared/scripts/theme.mjs from theme.json.
// Edit the theme with \`pnpm dev:theme\` or edit theme.json directly.
export const theme = ${JSON.stringify(webTheme, null, "\t")} as const;
export const ideTheme = ${JSON.stringify(ideTheme, null, "\t")} as const;
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
		webTheme.light.background
	],
	[
		"dark theme-color",
		/(<meta name="theme-color" content=")#[0-9a-f]{6}(" media="\(prefers-color-scheme: dark\)")/i,
		webTheme.dark.background
	],
	[
		"light first paint",
		/^(\+\s*html, body \{ background-color: )#[0-9a-f]{6}(; \})$/im,
		webTheme.light.background
	],
	[
		"dark first paint",
		/^(\+\s*@media \(prefers-color-scheme: dark\) \{ html, body \{ background-color: )#[0-9a-f]{6}(; \} \})$/im,
		webTheme.dark.background
	],
	[
		"app light first paint",
		/^(\+\s*html\[data-scheme="light"\], html\[data-scheme="light"\] body \{ background-color: )#[0-9a-f]{6}(; \})$/im,
		webTheme.light.background
	],
	[
		"app dark first paint",
		/^(\+\s*html\[data-scheme="dark"\], html\[data-scheme="dark"\] body \{ background-color: )#[0-9a-f]{6}(; \})$/im,
		webTheme.dark.background
	],
	[
		"manifest theme",
		/(theme_color: ")#[0-9a-f]{6}(")/i,
		webTheme.dark.background
	],
	[
		"manifest background",
		/(background_color: ")#[0-9a-f]{6}(")/i,
		webTheme.dark.background
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
		`Theme outputs are stale; run \`pnpm assets\`:\n${stale
			.map((path) => `  ${path}`)
			.join("\n")}`
	);
