#!/usr/bin/env node
// Colour console: the one place every colour in the product is edited.
//
//   pnpm theme            (then open the printed URL)
//
// It owns `theme` and `ideTheme` in packages/shared/index.ts, and applying an
// edit fans that out to every copy that cannot import them: the two IDE theme
// JSONs (~480 keys each, all views of ~30 roles), the first-paint colours pinned
// inside the patch stack, the prebuild Android accent, the persistence startup
// page, and - via the real generators - brand.css, the favicons, the launcher
// icons and the splash. Nothing here regenerates a file it does not own: the
// theme JSONs are rewritten role by role in place, so alphas, key order and
// comments survive untouched.
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const at = (...parts) => resolve(ROOT, ...parts);

const SHARED = at("packages/shared/index.ts");
const THEME_FILE = {
	dark: at(
		"packages/ide/overlay/lib/vscode/extensions/composery-themes/themes/composery-dark.json"
	),
	light: at(
		"packages/ide/overlay/lib/vscode/extensions/composery-themes/themes/composery-light.json"
	)
};
const SCHEMES = ["light", "dark"];

// ---- reading the source of truth ------------------------------------------

// index.ts is read as text, not imported: the console has to write it back with
// its comments intact, and an import would also cache the old values for the
// life of the process.
function readBlock(src, name) {
	const start = src.indexOf(`export const ${name} = {`);
	const end = src.indexOf("} as const;", start);
	return { start, end, text: src.slice(start, end) };
}

function readScheme(block, scheme) {
	const open = block.text.indexOf(`\n\t${scheme}: {`);
	const close = block.text.indexOf("\n\t}", open);
	const body = block.text.slice(open, close);
	const values = {};
	for (const [, key, value] of body.matchAll(/\n\t\t(\w+): "([^"]*)"/g))
		values[key] = value;
	return values;
}

export async function loadState() {
	const src = await readFile(SHARED, "utf8");
	const theme = readBlock(src, "theme");
	const ide = readBlock(src, "ideTheme");
	const links = Object.fromEntries(
		[
			...readBlock(src, "IDE_THEME_LINKS").text.matchAll(/\n\t(\w+): "(\w+)"/g)
		].map(([, from, to]) => [from, to])
	);
	const linkedBlock = readBlock(src, "ideLinked");
	const state = { theme: {}, ide: {}, links, linked: {} };
	for (const scheme of SCHEMES) {
		state.theme[scheme] = readScheme(theme, scheme);
		state.ide[scheme] = readScheme(ide, scheme);
		const list = linkedBlock.text.slice(
			linkedBlock.text.indexOf(`\n\t${scheme}: [`),
			linkedBlock.text.indexOf(
				"\n\t]",
				linkedBlock.text.indexOf(`\n\t${scheme}: [`)
			)
		);
		state.linked[scheme] = [...list.matchAll(/"(\w+)"/g)].map(
			([, role]) => role
		);
	}
	return state;
}

// ---- writing packages/shared/index.ts -------------------------------------

function writeScheme(text, scheme, values) {
	const open = text.indexOf(`\n\t${scheme}: {`);
	const close = text.indexOf("\n\t}", open);
	let body = text.slice(open, close);
	for (const [key, value] of Object.entries(values))
		body = body.replace(
			new RegExp(`(\\n\\t\\t${key}: ")[^"]*(")`),
			`$1${value}$2`
		);
	return text.slice(0, open) + body + text.slice(close);
}

// A linked role is stored resolved, not as a reference: every consumer of
// ideTheme reads a real colour and never has to know links exist. Resolving here,
// once, is also what stops a link from silently going stale - the value cannot
// disagree with its source because it is written from it.
function resolveLinks(next, links) {
	for (const scheme of SCHEMES)
		for (const role of next.linked[scheme]) {
			const source = links[role];
			if (source) next.ide[scheme][role] = next.theme[scheme][source];
		}
	return next;
}

function writeLinked(src, linked) {
	const block = readBlock(src, "ideLinked");
	let text = block.text;
	for (const scheme of SCHEMES) {
		const open = text.indexOf(`\n\t${scheme}: [`);
		const close = text.indexOf("\n\t]", open);
		const roles = linked[scheme];
		const body = roles.length
			? `\n\t${scheme}: [\n${roles.map((role) => `\t\t"${role}"`).join(",\n")}`
			: `\n\t${scheme}: [`;
		text = text.slice(0, open) + body + text.slice(close);
	}
	return src.slice(0, block.start) + text + src.slice(block.end);
}

async function writeShared(next) {
	let src = await readFile(SHARED, "utf8");
	src = writeLinked(src, next.linked);
	for (const [name, values] of [
		["theme", next.theme],
		["ideTheme", next.ide]
	]) {
		const block = readBlock(src, name);
		let text = block.text;
		for (const scheme of SCHEMES)
			text = writeScheme(text, scheme, values[scheme]);
		src = src.slice(0, block.start) + text + src.slice(block.end);
	}
	await writeFile(SHARED, src, "utf8");
}

// ---- the IDE theme JSONs ---------------------------------------------------

// The role each JSON key carries, consulted before any value lookup. Without it
// two roles that happen to share a value could never be pulled apart again:
// `chrome` equal to `editor` would resolve to `editor` and overwrite the chrome
// keys, welding the two together through every later save.
const KEY_ROLE = {
	"editor.background": "editor",
	"editor.foreground": "fg",
	"sideBar.background": "chrome",
	"sideBarSectionHeader.background": "chrome",
	"activityBar.background": "chrome",
	"activityBarTop.background": "chrome",
	"titleBar.activeBackground": "chrome",
	"titleBar.inactiveBackground": "chrome",
	"statusBar.background": "chrome",
	"statusBar.noFolderBackground": "chrome",
	"statusBar.debuggingBackground": "chrome",
	"panel.background": "chrome",
	"terminal.background": "chrome",
	"tab.activeBackground": "chrome",
	"tab.inactiveBackground": "chrome",
	"tab.unfocusedActiveBackground": "chrome",
	"tab.unfocusedInactiveBackground": "chrome",
	"editorGroupHeader.tabsBackground": "surface",
	"editorGroupHeader.noTabsBackground": "surface",
	"input.background": "surface",
	"dropdown.background": "surface",
	"list.hoverBackground": "hover",
	"list.activeSelectionBackground": "hover",
	"list.inactiveSelectionBackground": "hover",
	"statusBar.foreground": "muted",
	"editorLineNumber.foreground": "lineNumber",
	focusBorder: "focus",
	"editorGroup.border": "border",
	"widget.shadow": "shadow",
	"button.background": "primary",
	"button.foreground": "primaryFg",
	"editorGutter.addedBackground": "added",
	"editorGutter.deletedBackground": "removed",
	"editorGutter.modifiedBackground": "modified",
	"gitDecoration.ignoredResourceForeground": "ignored",
	"terminal.ansiBlack": "ansiBlack",
	"terminal.ansiRed": "ansiRed",
	"terminal.ansiGreen": "ansiGreen",
	"terminal.ansiYellow": "ansiYellow",
	"terminal.ansiBlue": "ansiBlue",
	"terminal.ansiMagenta": "ansiMagenta",
	"terminal.ansiCyan": "ansiCyan",
	"terminal.ansiWhite": "ansiWhite",
	"terminal.ansiBrightBlack": "ansiBrightBlack",
	"terminal.ansiBrightRed": "ansiRed",
	"terminal.ansiBrightGreen": "ansiGreen",
	"terminal.ansiBrightYellow": "ansiYellow",
	"terminal.ansiBrightBlue": "ansiBlue",
	"terminal.ansiBrightMagenta": "ansiMagenta",
	"terminal.ansiBrightCyan": "ansiCyan",
	"terminal.ansiBrightWhite": "fg"
};

// Order matters: an unpinned key whose value matches several roles takes the
// FIRST of them, so the broad surfaces have to come before the roles that only
// ever borrow their value.
const ROLE_ORDER = [
	"editor",
	"chrome",
	"surface",
	"hover",
	"fg",
	"muted",
	"lineNumber",
	"border",
	"focus",
	"shadow",
	"primary",
	"primaryFg",
	"keyword",
	"string",
	"number",
	"type",
	"variable",
	"punctuation",
	"comment",
	"invalid",
	"added",
	"removed",
	"modified",
	"ignored",
	"ansiBlack",
	"ansiRed",
	"ansiGreen",
	"ansiYellow",
	"ansiBlue",
	"ansiMagenta",
	"ansiCyan",
	"ansiWhite",
	"ansiBrightBlack"
];

// A role's value, assembled from the two halves of the palette.
function rolesFor(state, scheme) {
	const t = state.theme[scheme];
	const i = state.ide[scheme];
	return {
		editor: i.editor,
		chrome: i.chrome,
		surface: i.surface,
		hover: i.hover,
		fg: t.foreground,
		muted: t.mutedForeground,
		lineNumber: i.lineNumber,
		border: t.border,
		focus: i.focus,
		shadow: t.shadow,
		primary: t.primary,
		primaryFg: t.primaryForeground,
		keyword: i.keyword,
		string: i.string,
		number: i.number,
		type: i.type,
		variable: i.variable,
		punctuation: i.punctuation,
		comment: i.comment,
		invalid: i.invalid,
		added: t.success,
		removed: t.destructive,
		modified: t.warning,
		ignored: i.ignored,
		ansiBlack: i.ansiBlack,
		ansiRed: i.ansiRed,
		ansiGreen: i.ansiGreen,
		ansiYellow: i.ansiYellow,
		ansiBlue: i.ansiBlue,
		ansiMagenta: i.ansiMagenta,
		ansiCyan: i.ansiCyan,
		ansiWhite: i.ansiWhite,
		ansiBrightBlack: i.ansiBrightBlack
	};
}

// What the theme file currently says each role is. The rewrite keys off THIS,
// not off index.ts: the JSON is the thing being edited, so its own values are the
// only honest "before". Reading index.ts instead would silently strand the ~450
// keys that follow a role by value whenever the two drifted apart.
function rolesFromJson(data) {
	const anchors = {};
	for (const [key, role] of Object.entries(KEY_ROLE))
		if (!(role in anchors) && data.colors[key])
			anchors[role] = data.colors[key].slice(0, 7);

	for (const rule of data.tokenColors) {
		const foreground = rule.settings?.foreground;
		if (!foreground) continue;
		const scopes = scopesOf(rule);
		const role = tokenRole(scopes[0] ?? "", scopes.join(","));
		if (role && !(role in anchors)) anchors[role] = foreground;
	}
	return anchors;
}

// A pinned key takes the role verbatim, alpha included - that key IS the role.
// Everything else is a key that merely happens to share the role's colour, at its
// own strength: those keep their alpha, or one role would flatten the ~10
// different border and shadow strengths the theme draws with into one.
const paintPinned = (value, alpha) =>
	value.length > 7 ? value : value + alpha;
const paintShared = (value, alpha) => value.slice(0, 7) + alpha;

// A token rule's role comes from its FIRST scope, never from whichever pattern
// happens to match somewhere in its scope list.
const TOKEN_RULES = [
	[/^comment/, "comment"],
	[/^invalid/, "invalid"],
	[/^markup\.inserted/, "added"],
	[/^markup\.deleted/, "removed"],
	[/^(markup\.changed|meta\.diff|.*diff\.header)/, "modified"],
	[
		/^(punctuation|keyword\.operator|meta\.embedded|meta\.template)/,
		"punctuation"
	],
	[
		/^(string|.*regexp|.*regex|constant\.character\.escape|markup\.inline\.raw)/,
		"string"
	],
	[
		/^(entity\.name\.function|support\.function|meta\.function-call|entity\.name\.method)/,
		"number"
	],
	[
		/^(constant\.numeric|constant\.language|variable\.other\.constant|support\.constant|constant\.other|constant\.sha)/,
		"number"
	],
	[
		/^(entity\.name\.tag|entity\.name\.selector|support\.class|entity\.name\.type|support\.type|meta\.type|entity\.name\.namespace|entity\.other\.attribute-name\.class)/,
		"type"
	],
	[/^(keyword|storage|modifier)/, "keyword"],
	[
		/^(variable|entity\.other\.attribute-name|meta\.object-literal|.*dictionary\.key)/,
		"variable"
	],
	[
		/^(entity\.name\.label|markup\.bold|markup\.heading|markup\.italic|header)/,
		"fg"
	]
];

const scopesOf = (rule) => {
	const scope = rule.scope ?? "";
	return Array.isArray(scope) ? scope : scope.split(",").map((s) => s.trim());
};

const tokenRole = (first, whole) =>
	TOKEN_RULES.find(([re]) => re.test(first))?.[1] ??
	TOKEN_RULES.find(([re]) =>
		new RegExp(re.source.replace(/^\^/, "")).test(whole)
	)?.[1] ??
	null;

// One value can mean several roles (type and modified often share a hex), so an
// ambiguous match falls back to what the key is called.
const MODIFIED_KEY = /modified|editedFile|stageModified/i;

async function writeThemeJson(scheme, after) {
	const src = await readFile(THEME_FILE[scheme], "utf8");
	const data = JSON.parse(src);
	const before = rolesFromJson(data);

	const byValue = new Map();
	for (const role of ROLE_ORDER) {
		const value = (before[role] ?? "").toLowerCase();
		if (!byValue.has(value)) byValue.set(value, []);
		byValue.get(value).push(role);
	}

	const tokenRoles = data.tokenColors
		.filter((rule) => rule.settings?.foreground)
		.map((rule) => {
			const scopes = scopesOf(rule);
			return tokenRole(scopes[0] ?? "", scopes.join(","));
		});

	let section = null;
	let token = 0;
	let uiEdits = 0;
	let tokenEdits = 0;

	const lines = src.split("\n").map((line) => {
		if (line.includes('"colors"')) section = "ui";
		else if (line.includes('"tokenColors"')) section = "tokens";

		if (section === "tokens" && /^\s*"foreground":/.test(line)) {
			const indent = line.match(/^(\s*)/)[1];
			const comma = line.trimEnd().endsWith(",") ? "," : "";
			const role = tokenRoles[token++];
			if (role && after[role]) {
				tokenEdits++;
				return `${indent}"foreground": "${after[role]}"${comma}`;
			}
			return line;
		}

		if (section !== "ui") return line;
		const match = line.match(
			/^(\s*)"([^"]+)":\s*"(#[0-9a-fA-F]{6})([0-9a-fA-F]{0,2})"(,?)\s*$/
		);
		if (!match) return line;
		const [, indent, key, base, alpha, comma] = match;

		const pinned = KEY_ROLE[key];
		if (pinned && after[pinned]) {
			uiEdits++;
			return `${indent}"${key}": "${paintPinned(after[pinned], alpha)}"${comma}`;
		}

		const candidates = byValue.get(base.toLowerCase());
		if (!candidates?.length) return line;
		const set = new Set(candidates);
		let role = candidates[0];
		if (set.size > 1) {
			if (set.has("modified") && set.has("type"))
				role = MODIFIED_KEY.test(key) ? "modified" : "type";
			else if (set.has("punctuation")) role = "punctuation";
		}
		if (!after[role]) return line;
		uiEdits++;
		return `${indent}"${key}": "${paintShared(after[role], alpha)}"${comma}`;
	});

	const text = lines.join("\n");
	JSON.parse(text); // never write a broken theme
	await writeFile(THEME_FILE[scheme], text, "utf8");
	return { ui: uiEdits, tokens: tokenEdits };
}

// ---- the copies that live outside index.ts and the theme files -------------

// The workbench's synchronous first-paint snapshot, pinned inside the patch as
// literal colours. Context lines become a removed/added pair so the hunk's line
// counts stay intact and quilt still applies it at fuzz=0.
async function writeProductPins(colors) {
	const path = at("packages/ide/patches/product.diff");
	const out = [];
	let active = null;
	let edits = 0;
	for (const line of (await readFile(path, "utf8")).split("\n")) {
		if (line.includes("COLOR_THEME_DARK_INITIAL_COLORS")) active = "dark";
		else if (line.includes("COLOR_THEME_LIGHT_INITIAL_COLORS"))
			active = "light";
		else if (active && /^[ +]};$/.test(line)) active = null;

		const match = active && line.match(/^([ +])(\t'([^']+)': ')([^']*)(',?)$/);
		if (match) {
			const [, sign, head, key, value, tail] = match;
			const want = colors[active][key];
			if (want && want.toLowerCase() !== value.toLowerCase()) {
				edits++;
				if (sign === "+") {
					out.push(`+${head}${want}${tail}`);
					continue;
				}
				out.push(`-${head}${value}${tail}`, `+${head}${want}${tail}`);
				continue;
			}
		}
		out.push(line);
	}
	await writeFile(path, out.join("\n"), "utf8"); // \n only: patches must be pure LF
	return `product.diff ${edits} colours`;
}

// PWA manifest colours and the pre-theme first paint.
async function writeWebClientPins(light, dark) {
	const path = at("packages/ide/patches/web-client.diff");
	let text = await readFile(path, "utf8");
	const subs = [
		[
			/(<meta name="theme-color" content=")#[0-9a-fA-F]{6}(" media="\(prefers-color-scheme: light\)")/,
			light
		],
		[
			/(<meta name="theme-color" content=")#[0-9a-fA-F]{6}(" media="\(prefers-color-scheme: dark\)")/,
			dark
		],
		[/(html, body \{ background-color: )#[0-9a-fA-F]{6}(; \})/, light],
		[
			/(@media \(prefers-color-scheme: dark\) \{ html, body \{ background-color: )#[0-9a-fA-F]{6}(; \} \})/,
			dark
		],
		[
			/(html\[data-scheme="light"\], html\[data-scheme="light"\] body \{ background-color: )#[0-9a-fA-F]{6}(; \})/,
			light
		],
		[
			/(html\[data-scheme="dark"\], html\[data-scheme="dark"\] body \{ background-color: )#[0-9a-fA-F]{6}(; \})/,
			dark
		],
		[/(theme_color: ")#[0-9a-fA-F]{6}(")/, dark],
		[/(background_color: ")#[0-9a-fA-F]{6}(")/, dark]
	];
	for (const [re, value] of subs)
		text = text.replace(re, (_match, head, tail) => head + value + tail);
	await writeFile(path, text, "utf8");
	return "web-client.diff 8 colours";
}

// The persistence startup page is served before any stylesheet exists, and the
// prebuild plugin runs under plain node where the TS package is out of reach -
// both hardcode what they cannot import, and both are pinned by a test.
async function writeHandSyncedCopies(theme) {
	const readiness = at(
		"packages/ide/overlay/src/node/persistence/readiness.ts"
	);
	let page = await readFile(readiness, "utf8");
	page = page
		.replace(
			/(body\{margin:0;background:)#[0-9a-fA-F]{6}(;color:)#[0-9a-fA-F]{6}/,
			`$1${theme.light.background}$2${theme.light.foreground}`
		)
		.replace(
			/(@media \(prefers-color-scheme:dark\)\{body\{background:)#[0-9a-fA-F]{6}(;color:)#[0-9a-fA-F]{6}/,
			`$1${theme.dark.background}$2${theme.dark.foreground}`
		)
		.replace(
			/(html\[data-scheme="light"\] body\{background:)#[0-9a-fA-F]{6}(;color:)#[0-9a-fA-F]{6}/,
			`$1${theme.light.background}$2${theme.light.foreground}`
		)
		.replace(
			/(html\[data-scheme="dark"\] body\{background:)#[0-9a-fA-F]{6}(;color:)#[0-9a-fA-F]{6}/,
			`$1${theme.dark.background}$2${theme.dark.foreground}`
		);
	await writeFile(readiness, page, "utf8");

	const plugin = at("packages/mobile/plugins/android-dialog-theme.js");
	const source = await readFile(plugin, "utf8");
	await writeFile(
		plugin,
		source.replace(
			/const ACCENT = \{ light: "#[0-9a-fA-F]{6}", dark: "#[0-9a-fA-F]{6}" \};/,
			`const ACCENT = { light: "${theme.light.primary}", dark: "${theme.dark.primary}" };`
		),
		"utf8"
	);
	return "readiness.ts + android-dialog-theme.js";
}

async function apply(request) {
	const { links } = await loadState();
	const next = resolveLinks(request, links);
	await writeShared(next);

	const stats = {};
	for (const scheme of SCHEMES)
		stats[scheme] = await writeThemeJson(scheme, rolesFor(next, scheme));

	const colors = {};
	for (const scheme of SCHEMES)
		colors[scheme] = JSON.parse(
			await readFile(THEME_FILE[scheme], "utf8")
		).colors;

	const notes = [
		await writeProductPins(colors),
		await writeWebClientPins(
			next.theme.light.background,
			next.theme.dark.background
		),
		await writeHandSyncedCopies(next.theme)
	];

	// The real generators, so brand.css, the favicons, the launcher icons and
	// the splash come from the same pass rather than a later `pnpm assets`.
	for (const script of ["sync.mjs", "icons.mjs", "logo.mjs"])
		await run(process.execPath, [at("packages/shared/scripts", script)], {
			cwd: ROOT
		});
	notes.push("brand.css + icons + logo");
	return { stats, notes };
}

// ---- server ----------------------------------------------------------------

const PAGE = resolve(HERE, "app.html");
const server = createServer(async (req, res) => {
	try {
		if (req.url === "/" || req.url.startsWith("/?")) {
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			return res.end(await readFile(PAGE));
		}
		if (req.url === "/api/state") {
			res.writeHead(200, { "content-type": "application/json" });
			return res.end(JSON.stringify(await loadState()));
		}
		if (req.url === "/api/apply" && req.method === "POST") {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const result = await apply(JSON.parse(Buffer.concat(chunks).toString()));
			console.log("applied:", JSON.stringify(result.stats));
			for (const note of result.notes) console.log("  " + note);
			res.writeHead(200, { "content-type": "application/json" });
			return res.end(JSON.stringify({ ok: true, ...result }));
		}
		res.writeHead(404).end("not found");
	} catch (error) {
		console.error(error);
		res.writeHead(500, { "content-type": "application/json" });
		res.end(
			JSON.stringify({ ok: false, error: String(error?.stack ?? error) })
		);
	}
});

const port = Number(process.env.PORT ?? 7331);
server.listen(port, () =>
	console.log(`colour console: http://localhost:${port}`)
);
