import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
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
						"gitDecoration.addedResourceForeground",
						"gitDecoration.untrackedResourceForeground",
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

	test("every IDE role is wired, and nothing is wired that is not a role", () => {
		const generator = readRepoFile("packages/shared/scripts/theme.mjs");
		const consumed = new Set(
			[...generator.matchAll(/\bide\.([A-Za-z0-9]+)\b/g)].map(
				(match) => match[1]!
			)
		);

		expect([...consumed].sort()).toEqual(
			Object.keys(BRAND_IDE_THEME.light).sort()
		);
	});

	test.each(schemes)(
		"%s workbench and terminal neutrals follow the editable IDE roles",
		(scheme) => {
			const theme = readTheme(scheme);
			const colors = BRAND_IDE_THEME[scheme];
			for (const [role, keys] of [
				["titleBar", ["titleBar.activeBackground"]],
				["activityBar", ["activityBar.background"]],
				["sideBar", ["sideBar.background"]],
				["statusBar", ["statusBar.background"]],
				["editor", ["editor.background", "terminal.background"]],
				["widget", ["editorWidget.background", "quickInput.background"]],
				["tabActive", ["tab.activeBackground"]],
				["tabInactive", ["tab.inactiveBackground"]],
				["hover", ["list.hoverBackground", "quickInputList.focusBackground"]],
				["foreground", ["editor.foreground", "terminal.foreground"]],
				["mutedForeground", ["descriptionForeground"]],
				["border", ["editorWidget.border", "widget.border"]],
				["inputBorder", ["input.border"]],
				["focus", ["focusBorder"]],
				["shadow", ["widget.shadow"]],
				["primary", ["button.background"]],
				["primaryForeground", ["button.foreground"]],
				["lineNumber", ["editorLineNumber.foreground"]],
				["ignored", ["gitDecoration.ignoredResourceForeground"]],
				["gutterAdded", ["editorGutter.addedBackground"]],
				["gutterDeleted", ["editorGutter.deletedBackground"]],
				["selection", ["editor.selectionBackground"]],
				["cursor", ["editorCursor.foreground"]],
				["scrollbar", ["scrollbarSlider.background"]],
				["link", ["textLink.foreground"]],
				["ansiBlack", ["terminal.ansiBlack"]],
				["ansiMagenta", ["terminal.ansiMagenta"]],
				["ansiCyan", ["terminal.ansiCyan"]],
				["ansiWhite", ["terminal.ansiWhite"]],
				["ansiBrightBlack", ["terminal.ansiBrightBlack"]],
				["ansiBrightRed", ["terminal.ansiBrightRed"]],
				["ansiBrightWhite", ["terminal.ansiBrightWhite"]]
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

describe("colors editor", () => {
	test("pnpm dev includes the shared colors editor", () => {
		const rootPackage = JSON.parse(readRepoFile("package.json")) as {
			scripts: Record<string, string>;
		};
		const sharedPackage = JSON.parse(
			readRepoFile("packages/shared/package.json")
		) as {
			scripts: Record<string, string>;
		};
		expect(rootPackage.scripts["dev:colors"]).toBe(
			"pnpm --filter shared dev:colors"
		);
		expect(rootPackage.scripts.dev).toContain('"pnpm dev:colors"');
		expect(sharedPackage.scripts["dev:colors"]).toBe(
			"node tools/colors/server.mjs"
		);
	});

	const readGroups = () => {
		const page = readRepoFile("packages/shared/tools/colors/index.html");
		const block = page.slice(page.indexOf("const GROUPS = "));
		return JSON.parse(
			block.slice(block.indexOf("["), block.indexOf("];") + 1)
		) as [string, [string, string, string][]][];
	};

	test("the focused editor previews both surfaces", () => {
		const page = readRepoFile("packages/shared/tools/colors/index.html");

		expect(page).toContain('data-value="web"');
		expect(page).toContain('data-value="ide"');
		expect(page).toContain("const WEBSITE =");
		expect(page).toContain("const IDE =");
		expect(page).not.toContain("const MOBILE =");
		expect(page).not.toContain("const DOCS =");
		expect(page).toContain('text.type = "text"');
		expect(page).toContain(
			"grid-template-columns: minmax(0, 1fr) 26px 34px 94px 26px 22px"
		);
	});

	test("one list covers every role exactly once, under a unique label", () => {
		const listed: Record<"web" | "ide", string[]> = { web: [], ide: [] };
		const labels: string[] = [];

		for (const [, entries] of readGroups())
			for (const [area, key, label] of entries) {
				expect(["web", "ide"], key).toContain(area);
				listed[area as "web" | "ide"].push(key);
				labels.push(label);
			}

		expect([...listed.web].sort()).toEqual(
			Object.keys(source.web.light).sort()
		);
		expect([...listed.ide].sort()).toEqual(
			Object.keys(source.ide.light).sort()
		);
		expect(new Set(listed.web).size).toBe(listed.web.length);
		expect(new Set(listed.ide).size).toBe(listed.ide.length);
		expect(new Set(labels).size, "labels must be unique").toBe(labels.length);
	});

	test("equal values link, and a role can be detached from its group", () => {
		const page = readRepoFile("packages/shared/tools/colors/index.html");

		expect(page).toContain("function linkedRoles(source, key)");
		expect(page).toContain(
			"if (detached.has(`${source}.${key}`)) return [[source, key]]"
		);
		expect(page).toContain(
			"if (current === value && !detached.has(`${area}.${name}`))"
		);
		expect(page).toContain("startOn(linkedRoles(source, key))");
		expect(page).toContain("for (const [peerSource, peerKey] of editing)");
		expect(page).toContain("if (detached.has(id)) detached.delete(id);");
		expect(page).toContain("else detached.add(id);");
	});

	test("each row states the surface it belongs to", () => {
		const page = readRepoFile("packages/shared/tools/colors/index.html");

		expect(page).toContain('tag.className = "area"');
		expect(page).toContain("tag.textContent = source");
		expect(page).toContain("row.append(name, tag, swatch, text, link, reset)");
	});

	test("hiding linked rows keeps one row per distinct value", () => {
		const page = readRepoFile("packages/shared/tools/colors/index.html");

		expect(page).toContain("first = loose || !seen.has(value)");
		expect(page).toContain("row.hidden = elsewhere || (hideLinked && !first)");
		expect(page).toContain("const elsewhere = onlyArea && source !== area");
		// the per-group count has to be zeroed each paint, or a group hides once
		// and never comes back
		expect(page).toContain(
			"for (const section of sections) section.visible = 0"
		);
		expect(page).toContain("section.group.hidden = section.visible === 0");
		expect(page).toContain("if (!row.hidden) tally.visible += 1");
		expect(page).toContain('<input id="hide-linked" type="checkbox" />');
		expect(page).toContain('<input id="only-area" type="checkbox" />');
	});

	test("the history skips no-op gestures and names what it holds", () => {
		const page = readRepoFile("packages/shared/tools/colors/index.html");

		expect(page).toContain(
			"history.push({ theme: snapshot(), label: pending })"
		);
		expect(page).toContain("function settle()");
		expect(page).toContain(
			"if (!top || JSON.stringify(top.theme) !== JSON.stringify(theme)) return;"
		);
		expect(page).toContain("`Undo ${history.at(-1).label} (Ctrl+Z)`");
		expect(page).toContain("`Redo ${future.at(-1).label} (Ctrl+Y)`");
		// an edit that lands on the value already there must not open an entry
		expect(page).toContain("theme[peerSource][scheme][peerKey] === next");
	});

	test("everything can be reset, exported, and imported back", () => {
		const page = readRepoFile("packages/shared/tools/colors/index.html");

		expect(page).toContain('startEdit("reset all")');
		expect(page).toContain("resetAllButton.disabled =");
		expect(page).toContain("JSON.stringify(theme) === JSON.stringify(saved)");
		// the transfer text is byte-for-byte what the server writes to theme.json
		expect(page).toContain("transferText.value =");
		expect(page).toContain('JSON.stringify(theme, null, "\\t")');
		expect(page).toContain("function readTransfer(text)");
		expect(page).toContain("does not list every role");
		expect(page).toContain("is not a colour");
		expect(page).toContain('startEdit("import")');
		// applying is off unless the text is both readable and different
		expect(page).toContain("function reviewTransfer()");
		expect(page).toContain("applyButton.disabled = same");
		expect(page).toContain("transferText.oninput = reviewTransfer");
		expect(page).toContain("if (!next) return;");
		expect(page).not.toContain("transfer-copy");
		// Apply carries the same weight as Save rather than a bare browser button
		expect(page).toContain('<button class="primary" id="save">');
		expect(page).toContain('<button class="primary" id="transfer-apply">');
		expect(page).toContain(".primary {");
	});

	test("the editor remembers where you left off", () => {
		const page = readRepoFile("packages/shared/tools/colors/index.html");

		expect(page).toContain('window.COLORS_STORE = "composery-colors"');
		expect(page).toContain("const STORE = window.COLORS_STORE");
		for (const field of [
			"area,",
			"scheme,",
			"hideLinked,",
			"onlyArea,",
			"detached: [...detached]",
			"vars: painted"
		])
			expect(page, field).toContain(field);
		expect(page).toContain("localStorage.getItem(STORE)");
		expect(page).toContain("localStorage.setItem(");
	});

	test("the first frame is already painted, before the palette is fetched", () => {
		const page = readRepoFile("packages/shared/tools/colors/index.html");
		const head = page.slice(0, page.indexOf("</head>"));

		// the pre-render script runs from the head, ahead of the module
		expect(head).toContain("localStorage.getItem(window.COLORS_STORE)");
		expect(head).toContain(
			'root.style.colorScheme = last.scheme === "dark" ? "dark" : "light"'
		);
		expect(head).toContain(
			"for (const [name, value] of Object.entries(last.vars ?? {}))"
		);
		// and it replays what paint() recorded, so nothing reflows afterwards
		expect(page).toContain("painted = {}");
		expect(page).toContain(
			"for (const [name, value] of Object.entries(painted))"
		);
		expect(page).toContain("scrollbar-gutter: stable");
	});

	test("pasted colours are cleaned up rather than rejected", () => {
		const page = readRepoFile("packages/shared/tools/colors/index.html");
		const begin = page.indexOf("function normalize(value) {");
		const body = page.slice(begin, page.indexOf("\n\t\t\t}", begin) + 5);
		const normalize = runInNewContext(`${body}; normalize`) as (
			value: string
		) => string | null;

		for (const [raw, expected] of [
			["#0a0a0a", "#0a0a0a"],
			["0a0a0a", "#0a0a0a"],
			["  '#AABBCC';  ", "#aabbcc"],
			["0xff0000", "#ff0000"],
			["abc", "#aabbcc"],
			["#FFF", "#ffffff"],
			["1a2b3c4d", "#1a2b3c4d"],
			["rgb(1, 2, 3)", null],
			["12345", null],
			["", null]
		] as const)
			expect(normalize(raw), raw).toBe(expected);
	});

	test("edits are undoable one gesture at a time", () => {
		const page = readRepoFile("packages/shared/tools/colors/index.html");

		expect(page).toContain(
			"history.push({ theme: snapshot(), label: pending })"
		);
		expect(page).toContain("function commitOnce()");
		expect(page).toContain(
			'const redo = key === "y" || (key === "z" && event.shiftKey)'
		);
		expect(page).toContain(
			"step(redo ? future : history, redo ? history : future)"
		);
		expect(page).toContain("undoButton.onclick = () => step(history, future)");
		expect(page).toContain("redoButton.onclick = () => step(future, history)");
		expect(page).toContain("undoButton.disabled = history.length === 0");
	});

	test("values reset to what was last saved", () => {
		const page = readRepoFile("packages/shared/tools/colors/index.html");

		expect(page).toContain("let saved = structuredClone(theme)");
		expect(page).toContain("if (response.ok) saved = structuredClone(theme)");
		expect(page).toContain("const peers = linkedRoles(source, key)");
		expect(page).toContain("for (const [peerSource, peerKey] of peers)");
		expect(page).toContain("saved[peerSource][scheme][peerKey];");
		expect(page).toContain("reset.disabled = shared.every(");
	});

	test("the picker is hex-first, so no native colour input remains", () => {
		const page = readRepoFile("packages/shared/tools/colors/index.html");

		expect(page).not.toContain('type="color"');
		expect(page).toContain('<input class="hex" type="text"');
		expect(page).toContain("picker.showPopover()");
	});

	test("the scheme toggle repaints the editor, not only the preview", () => {
		const page = readRepoFile("packages/shared/tools/colors/index.html");

		expect(page).toContain("const root = document.documentElement");
		expect(page).toContain("root.style.colorScheme = scheme");
		expect(page).toContain("root.style.setProperty(");
		for (const rule of [
			"background: var(--muted)",
			"background: var(--background)",
			"color: var(--foreground)",
			"background: var(--popover)"
		])
			expect(page, rule).toContain(rule);
	});

	test("editor chrome only uses neutral greys or shared theme colours", () => {
		const page = readRepoFile("packages/shared/tools/colors/index.html");
		const allowed = new Set<string>([
			...Object.values(BRAND_THEME.dark),
			...Object.values(BRAND_IDE_THEME.dark)
		]);
		const chrome = page.slice(
			page.indexOf("<style>"),
			page.indexOf("</style>")
		);

		for (const color of chrome.match(/#[0-9a-f]{3,8}\b/g) ?? []) {
			const [, red, green, blue] = /^#(..)(..)(..)/.exec(color) ?? [];
			if (!red) continue;
			const neutral = red === green && green === blue;
			expect(neutral || allowed.has(color.slice(0, 7)), color).toBe(true);
		}
	});
});
