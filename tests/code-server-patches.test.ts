import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { loopbackCallbackParamNames } from "./support/loopbackCallbackGuard.ts";

const repoRoot = resolve(import.meta.dirname, "..");

function readRepoFile(path: string): string {
	return readFileSync(resolve(repoRoot, path), "utf8");
}

function extractLoopbackParamLists(patch: string): string[][] {
	const lists: string[][] = [];
	const pattern =
		/\+const loopbackCallbackParamNames = new Set\(\[\r?\n(?<body>(?:\+\t'[^']+',\r?\n)+)\+\]\);/g;

	for (const match of patch.matchAll(pattern)) {
		const body = match.groups?.body ?? "";
		lists.push(
			body
				.trimEnd()
				.split(/\r?\n/)
				.map((line) => line.replace(/^\+\t'|'[,]$/g, ""))
		);
	}

	return lists;
}

describe("IDE patch stack", () => {
	test("keeps touch editor source aligned with the split touch/narrow overlays", () => {
		const base =
			"packages/ide/overlay/lib/vscode/out/vs/code/browser/workbench/workbench-assets";
		const touchEditorPatch = readRepoFile(
			"packages/ide/patches/touch-editor.diff"
		);
		const touchCss = readRepoFile(`${base}/touch.css`);
		const narrowCss = readRepoFile(`${base}/narrow.css`);
		const narrowJs = readRepoFile(`${base}/narrow.js`);

		expect(touchEditorPatch).toContain("TOUCH_SELECTION_THRESHOLD");
		expect(touchEditorPatch).toContain("composery-touch-selection-handles");
		expect(touchEditorPatch).toContain(
			"this.viewController.setSelection(nextSelection)"
		);
		// Touch gate owns the selection handles; narrow gate owns viewport vars + keyboard inset.
		expect(touchCss).toContain(".composery-touch-selection-handle");
		expect(narrowCss).toContain("--composery-touch-keyboard-inset");
		expect(narrowJs).toContain("updateViewportVars");
	});

	test("keeps loopback callback parameter names aligned across copied runtime patches", () => {
		const markdownPatch = readRepoFile(
			"packages/ide/patches/markdown-preview-loopback-callback-bridge.diff"
		);
		const trustedDomainsPatch = readRepoFile(
			"packages/ide/patches/trusted-domains-loopback-callback-guard.diff"
		);

		const lists = [
			...extractLoopbackParamLists(markdownPatch),
			...extractLoopbackParamLists(trustedDomainsPatch)
		];

		expect(lists).toHaveLength(2);
		for (const list of lists) {
			expect(list).toEqual([...loopbackCallbackParamNames]);
		}
	});

	test("keeps Markdown preview as a bridge and trusted domains as the decision point", () => {
		const markdownPatch = readRepoFile(
			"packages/ide/patches/markdown-preview-loopback-callback-bridge.diff"
		);
		const trustedDomainsPatch = readRepoFile(
			"packages/ide/patches/trusted-domains-loopback-callback-guard.diff"
		);

		expect(markdownPatch).toContain(
			"shouldDelegateLoopbackCallbackLinkToVsCode"
		);
		expect(markdownPatch).not.toContain("hasSuspiciousLoopbackCallback");
		expect(markdownPatch).not.toContain(
			"return vscode.commands.executeCommand('vscode.open'"
		);

		expect(trustedDomainsPatch).toContain(
			"private async promptForLoopbackCallbackLink"
		);
		expect(trustedDomainsPatch).toContain("this._notificationService.prompt");
	});

	test("checks loopback callbacks before trusted-workspace bypasses", () => {
		const trustedDomainsPatch = readRepoFile(
			"packages/ide/patches/trusted-domains-loopback-callback-guard.diff"
		);

		const guardIndex = trustedDomainsPatch.indexOf(
			"+\t\tconst resourceUrl = parseHttpUrl"
		);
		const trustedWorkspaceIndex = trustedDomainsPatch.indexOf(
			"+\t\tif (openOptions?.fromWorkspace"
		);

		expect(guardIndex).toBeGreaterThanOrEqual(0);
		expect(trustedWorkspaceIndex).toBeGreaterThan(guardIndex);
	});

	test("routes suspicious Markdown HTTP links before normal pass-through schemes", () => {
		const markdownPatch = readRepoFile(
			"packages/ide/patches/markdown-preview-loopback-callback-bridge.diff"
		);

		const suspiciousRouteIndex = markdownPatch.indexOf(
			"if (shouldDelegateLoopbackCallbackLinkToVsCode(hrefText))"
		);
		const passThroughIndex = markdownPatch.indexOf(
			"passThroughLinkSchemes.some"
		);

		expect(suspiciousRouteIndex).toBeGreaterThanOrEqual(0);
		expect(passThroughIndex).toBeGreaterThan(suspiciousRouteIndex);
	});
});

describe("composery agent setup", () => {
	const extension = readRepoFile(
		"packages/ide/overlay/lib/vscode/extensions/composery-agents/extension.js"
	);
	const welcome = readRepoFile("packages/ide/patches/welcome.diff");

	// AGENTS entries in the extension: id: "claude"
	const extensionIds = [...extension.matchAll(/\bid:\s*"([a-z]+)"/g)].map(
		(match) => match[1]
	);
	// Agent objects added to the welcome card: { id: 'claude', name: ...
	const welcomeIds = [...welcome.matchAll(/\{\s*id:\s*'([a-z]+)'/g)].map(
		(match) => match[1]
	);

	test("welcome card and extension cover the same agents in the same order", () => {
		expect(extensionIds).toHaveLength(6);
		expect(welcomeIds).toEqual(extensionIds);
	});

	test("every agent ships a logo served from the welcome _static media path", () => {
		for (const id of extensionIds) {
			const logo = resolve(
				repoRoot,
				`packages/ide/src/browser/media/agents/${id}.svg`
			);
			expect(existsSync(logo)).toBe(true);
		}
	});

	test("agent logos are accent-tinted via a CSS mask", () => {
		// Each logo is a CSS mask filled with the theme accent, so it reads as one
		// accent silhouette and adapts to light/dark through the variable.
		expect(welcome).toContain(
			"background-color: var(--vscode-textLink-foreground)"
		);
		expect(welcome).toContain(
			"url(./_static/src/browser/media/agents/${agent.id}.svg)"
		);
	});

	test("welcome card dispatches installs through the composery-agents command", () => {
		// Direct command dispatch, not a command: href (which the getting-started
		// page lets the browser follow and break the workbench).
		expect(welcome).not.toContain("command:composery");
		expect(welcome).toContain(
			"this.commandService.executeCommand('composery.installAgent'"
		);
		expect(extension).toContain('registerCommand("composery.installAgent"');
	});
});

describe("composery shortcuts", () => {
	const extension = readRepoFile(
		"packages/ide/overlay/lib/vscode/extensions/composery-shortcuts/extension.js"
	);
	const manifest = readRepoFile(
		"packages/ide/overlay/lib/vscode/extensions/composery-shortcuts/package.json"
	);
	const shortcutsPatch = readRepoFile("packages/ide/patches/shortcuts.diff");
	const series = readRepoFile("packages/ide/patches/series");

	test("keeps patched internal commands aligned with the extension", () => {
		for (const command of [
			"composery.shortcuts.pickIcon",
			"composery.shortcuts.pickColor",
			"composery.shortcuts.resolveVariables"
		]) {
			expect(extension).toContain(command);
			expect(shortcutsPatch).toContain(command);
		}
	});

	test("loads the shortcut contribution from the terminal workbench contribution", () => {
		expect(shortcutsPatch).toContain("import './shortcuts.contribution.js';");
		expect(shortcutsPatch).toContain("TerminalIconPicker");
		expect(shortcutsPatch).toContain("createColorStyleElement");
		expect(shortcutsPatch).toContain("IConfigurationResolverService");
		expect(series.trimEnd().split(/\r?\n/)).toContain("shortcuts.diff");
	});

	test("ships the full shortcut command surface", () => {
		const parsed = JSON.parse(manifest) as {
			contributes: { commands: Array<{ command: string }> };
		};
		const commands = parsed.contributes.commands.map((entry) => entry.command);

		expect(commands).toEqual([
			"composery.shortcuts.run",
			"composery.shortcuts.add",
			"composery.shortcuts.edit",
			"composery.shortcuts.duplicate",
			"composery.shortcuts.remove",
			"composery.shortcuts.moveUp",
			"composery.shortcuts.moveDown",
			"composery.shortcuts.refresh",
			"composery.shortcuts.undoRemove"
		]);
	});

	test("covers terminal, file, and folder shortcut behavior", () => {
		expect(extension).toContain('type: "terminal"');
		expect(extension).toContain('type: "file"');
		expect(extension).toContain('type: "folder"');
		expect(extension).toContain("vscode.openFolder");
		expect(extension).toContain("text/uri-list");
		expect(extension).toContain("new vscode.ThemeIcon");
		expect(extension).not.toContain("shortcut.kind");
	});

	test("settles on Run Shortcut naming", () => {
		expect(extension).not.toContain("Open Shortcut");
		expect(manifest).not.toContain("Open Shortcut");
		expect(manifest).toContain('"title": "Run Shortcut"');
	});

	test("persists storage without losing data", () => {
		// Writes go through a temp file + rename so an interrupted write can't
		// truncate the real file, and unreadable contents are backed up rather
		// than crashing activation.
		expect(extension).toContain(".rename(");
		expect(extension).toContain(".bak");
		expect(extension).toContain("await this.backup(");
	});

	test("creates file and folder shortcuts from dropped resources", () => {
		// Dropping Explorer/OS items onto the view stats each resource and
		// creates file/folder shortcuts.
		expect(extension).toContain(
			'this.dropMimeTypes = [TREE_MIME, "text/uri-list"]'
		);
		expect(extension).toContain("vscode.workspace.fs.stat");
		expect(extension).toContain("fileOrFolderShortcut");
		expect(extension).toContain("hasResourceShortcut");
	});
});
