import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

import { describe, expect, test } from "vitest";

import { loopbackCallbackParamNames } from "./support/loopbackCallbackGuard.ts";

const repoRoot = resolve(import.meta.dirname, "..");

function readRepoFile(path: string): string {
	return readFileSync(resolve(repoRoot, path), "utf8");
}

function runNarrowViewportVars({
	envInset = 0,
	innerHeight = 800,
	virtualKeyboard,
	visualViewport
}: {
	envInset?: number;
	innerHeight?: number;
	virtualKeyboard?: {
		bottom: number;
		height: number;
		overlaysContent?: boolean;
		y: number;
	};
	visualViewport?: { height: number; offsetTop: number; width?: number };
}): Map<string, string> {
	const narrowJs = readRepoFile(
		"packages/ide/overlay/lib/vscode/out/vs/code/browser/workbench/workbench-assets/narrow.js"
	);
	const properties = new Map<string, string>();
	const documentElement = {
		style: {
			setProperty(name: string, value: string) {
				properties.set(name, value);
			}
		}
	};
	const body = {
		appendChild(element: { isConnected?: boolean }) {
			element.isConnected = true;
		}
	};

	const context = vm.createContext({
		HTMLElement: class HTMLElement {},
		KeyboardEvent: class KeyboardEvent {
			constructor() {}
		},
		MutationObserver: class MutationObserver {
			observe() {}
		},
		document: {
			body,
			createElement() {
				return {
					isConnected: false,
					offsetHeight: envInset,
					setAttribute() {},
					style: { cssText: "" }
				};
			},
			documentElement,
			querySelectorAll: () => [],
			addEventListener() {}
		},
		getComputedStyle: () => ({
			display: "none",
			visibility: "hidden"
		}),
		history: {
			back() {},
			pushState() {},
			state: undefined
		},
		location: { href: "https://example.test/" },
		navigator: virtualKeyboard
			? {
					virtualKeyboard: {
						addEventListener() {},
						boundingRect: virtualKeyboard,
						overlaysContent: virtualKeyboard.overlaysContent ?? true
					}
				}
			: {},
		window: {
			addEventListener() {},
			innerHeight,
			innerWidth: visualViewport?.width ?? 390,
			matchMedia: () => ({
				addEventListener() {},
				matches: false
			}),
			requestAnimationFrame() {},
			setTimeout() {},
			visualViewport: visualViewport
				? {
						addEventListener() {},
						height: visualViewport.height,
						offsetTop: visualViewport.offsetTop,
						width: visualViewport.width ?? 390
					}
				: undefined
		}
	});
	vm.runInContext(narrowJs, context);

	return properties;
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

function extractAddedFunction(patch: string, name: string): string {
	const addedSource = patch
		.split(/\r?\n/)
		.filter((line) => line.startsWith("+") && !line.startsWith("+++"))
		.map((line) => line.slice(1))
		.join("\n");
	const start = addedSource.indexOf(`function ${name}`);
	if (start < 0) {
		throw new Error(`Could not find added function ${name}`);
	}

	let depth = 0;
	for (let i = addedSource.indexOf("{", start); i < addedSource.length; i++) {
		const char = addedSource[i];
		if (char === "{") depth++;
		else if (char === "}") {
			depth--;
			if (depth === 0) {
				return addedSource.slice(start, i + 1);
			}
		}
	}

	throw new Error(`Could not parse added function ${name}`);
}

function addedFileHunkCounts(
	patch: string
): Array<{ actual: number; declared: number }> {
	const lines = patch.split(/\r?\n/);
	const counts: Array<{ actual: number; declared: number }> = [];

	for (let index = 0; index < lines.length; index++) {
		const current = lines[index];
		if (current === undefined) {
			continue;
		}

		const header = current.match(/^@@ -0,0 \+1,(?<declared>\d+) @@/);
		if (!header?.groups) {
			continue;
		}

		let actual = 0;
		for (index++; index < lines.length; index++) {
			const line = lines[index];
			if (line === undefined) {
				break;
			}

			if (
				line.startsWith("diff --git ") ||
				line.startsWith("--- /dev/null") ||
				line.startsWith("@@ ")
			) {
				index--;
				break;
			}
			if (line.startsWith("+") && !line.startsWith("+++")) {
				actual++;
			}
		}

		counts.push({ actual, declared: Number(header.groups.declared) });
	}

	return counts;
}

type WebviewViewportMeta = {
	content?: string;
	name?: string;
	getAttribute(name: string): string | undefined;
	setAttribute(name: string, value: string): void;
};

type WebviewViewportDocument = {
	createElement(): WebviewViewportMeta;
	head: { prepend(meta: WebviewViewportMeta): void };
	querySelectorAll(): WebviewViewportMeta[];
};

function webviewViewportAfterEnsure(
	initialContent?: string
): string | undefined {
	const webviewPatch = readRepoFile("packages/ide/patches/webview-mobile.diff");
	const functionSource = extractAddedFunction(
		webviewPatch,
		"ensureMobileViewport"
	);
	const context = vm.createContext({});
	vm.runInContext(
		`${functionSource}; globalThis.ensureMobileViewport = ensureMobileViewport;`,
		context
	);

	const metas: WebviewViewportMeta[] = [];
	if (initialContent !== undefined) {
		metas.push({
			content: initialContent,
			name: "viewport",
			getAttribute(name: string) {
				return name === "name" ? this.name : this.content;
			},
			setAttribute(name: string, value: string) {
				if (name === "content") this.content = value;
			}
		});
	}

	const documentLike: WebviewViewportDocument = {
		createElement() {
			return {
				content: "",
				name: "",
				getAttribute(name: string) {
					return name === "name" ? this.name : this.content;
				},
				setAttribute(name: string, value: string) {
					if (name === "content") this.content = value;
				}
			};
		},
		head: {
			prepend(meta: WebviewViewportMeta) {
				metas.unshift(meta);
			}
		},
		querySelectorAll() {
			return metas;
		}
	};

	(
		context as unknown as {
			ensureMobileViewport(documentLike: WebviewViewportDocument): void;
		}
	).ensureMobileViewport(documentLike);

	return metas[0]?.content;
}

describe("IDE patch stack", () => {
	test("keeps touch editor source aligned with the split touch/narrow overlays", () => {
		const base =
			"packages/ide/overlay/lib/vscode/out/vs/code/browser/workbench/workbench-assets";
		const buildScript = readRepoFile("packages/ide/build.sh");
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
		expect(touchCss).toContain(".composery-touch-selection-handle");
		expect(narrowCss).toContain("--composery-touch-keyboard-inset");
		expect(narrowJs).toContain("updateViewportVars");
		expect(buildScript).toContain(
			'rsync -a "$HERE/overlay/lib/vscode/out/" "$BUILD/release/lib/vscode/out/"'
		);
	});

	test("keeps the IDE and auth pages on the mobile viewport contract", () => {
		const overlaysPatch = readRepoFile("packages/ide/patches/overlays.diff");

		expect(overlaysPatch).toContain("viewport-fit=cover");
		expect(overlaysPatch).toContain("interactive-widget=resizes-content");
		expect(overlaysPatch).toContain(
			"lib/vscode/src/vs/code/browser/workbench/callback.html"
		);
		expect(overlaysPatch).toContain(
			"lib/vscode/src/vs/code/browser/workbench/workbench-dev.html"
		);

		for (const page of [
			"packages/ide/overlay/src/browser/pages/error.html",
			"packages/ide/overlay/src/browser/pages/login.html",
			"packages/ide/overlay/src/browser/pages/register.html",
			"packages/ide/overlay/src/browser/pages/reset-password.html"
		]) {
			const html = readRepoFile(page);

			expect(html).toContain("viewport-fit=cover");
			expect(html).toContain("interactive-widget=resizes-content");
		}

		const startupPage = readRepoFile(
			"packages/ide/overlay/src/node/persistence/readiness.ts"
		);
		const authCss = readRepoFile(
			"packages/ide/overlay/src/browser/pages/global.css"
		);
		expect(startupPage).toContain("viewport-fit=cover");
		expect(startupPage).toContain("safe-area-inset-bottom");
		expect(authCss).toContain("text-size-adjust: 100%");
		expect(authCss).toContain('input:not([type="hidden"])');
		expect(authCss).toContain("font-size: max(16px, 1em)");
	});

	test("keeps keyboard and safe-area insets shared across narrow overlays", () => {
		const base =
			"packages/ide/overlay/lib/vscode/out/vs/code/browser/workbench/workbench-assets";
		const narrowJs = readRepoFile(`${base}/narrow.js`);
		const narrowCss = readRepoFile(`${base}/narrow.css`);
		const touchGatePatch = readRepoFile("packages/ide/patches/touch-gate.diff");
		const keybarPatch = readRepoFile(
			"packages/ide/patches/touch-terminal-keybar.diff"
		);

		expect(narrowJs).toContain("env(keyboard-inset-height,0px)");
		expect(narrowJs).toContain("navigator.virtualKeyboard");
		expect(narrowJs).toContain("bottomKeyboardOverlap");
		expect(narrowJs).toContain("geometrychange");
		expect(narrowJs).toContain("postNativeOverlayBackGuard");
		expect(narrowJs).toContain("__composeryNative");
		expect(narrowJs).toContain("composery:overlay-back:");
		expect(narrowJs).not.toContain("diagnostic HUD");
		expect(narrowCss).toContain("text-size-adjust: 100%");
		expect(narrowCss).toContain("--composery-safe-area-bottom");
		expect(narrowCss).toContain("safe-area-inset-bottom");
		for (const selector of [
			".action-list-submenu-panel",
			".context-view",
			".suggest-details-container"
		]) {
			expect(narrowJs).toContain(selector);
			expect(narrowCss).toContain(selector);
		}
		expect(narrowCss).toContain("textarea:not(.inputarea)");
		expect(narrowCss).toContain("body input:not(.inputarea)");
		expect(narrowCss).toContain("(hover: none) and (pointer: coarse)");
		expect(narrowCss).toContain("xterm-helper-textarea");
		expect(narrowCss).toContain("font-size: 16px !important");
		expect(narrowCss).toContain("notifications-center");
		expect(narrowCss).toContain("notifications-toasts");
		expect(narrowCss).toContain("notification-toast-container");
		expect(narrowCss).toContain(".notifications-center.top-right");
		expect(narrowCss).toContain("monaco-scrollable-element");
		expect(touchGatePatch).toContain("bottomKeyboardOverlap");
		expect(touchGatePatch).toContain("overlaysContent");
		expect(keybarPatch).toContain("safe-area-inset-bottom");
		expect(keybarPatch).toContain("'scroll', () => this.update()");
	});

	test("keeps terminal keybar added-file patch hunks from truncating", () => {
		const keybarPatch = readRepoFile(
			"packages/ide/patches/touch-terminal-keybar.diff"
		);

		expect(addedFileHunkCounts(keybarPatch)).toEqual([
			{ actual: 214, declared: 214 },
			{ actual: 75, declared: 75 }
		]);
		expect(keybarPatch).toContain(
			"keyboardInset(mainWindow) > KEYBOARD_THRESHOLD;"
		);
		expect(keybarPatch).toContain(
			"registerWorkbenchContribution2(TerminalKeybarContribution.ID"
		);
	});

	test("computes keyboard inset from actual bottom overlap", () => {
		expect(
			runNarrowViewportVars({
				visualViewport: { height: 520, offsetTop: 0 }
			}).get("--composery-touch-keyboard-inset")
		).toBe("280px");

		expect(
			runNarrowViewportVars({
				virtualKeyboard: { bottom: 800, height: 280, y: 520 },
				visualViewport: { height: 800, offsetTop: 0 }
			}).get("--composery-touch-keyboard-inset")
		).toBe("280px");

		expect(
			runNarrowViewportVars({
				envInset: 220,
				visualViewport: { height: 800, offsetTop: 0 }
			}).get("--composery-touch-keyboard-inset")
		).toBe("220px");

		expect(
			runNarrowViewportVars({
				virtualKeyboard: { bottom: 500, height: 200, y: 300 },
				visualViewport: { height: 800, offsetTop: 0 }
			}).get("--composery-touch-keyboard-inset")
		).toBe("0px");
	});

	test("configures the native mobile WebView as a stable IDE surface", () => {
		const appConfig = readRepoFile("packages/mobile/app.json");
		const instanceScreen = readRepoFile(
			"packages/mobile/src/app/instance/[id].tsx"
		);

		expect(appConfig).toContain('"orientation": "default"');
		expect(instanceScreen).toContain(
			"keyboardDisplayRequiresUserAction={false}"
		);
		expect(instanceScreen).toContain('overScrollMode="never"');
		expect(instanceScreen).toContain("bounces={false}");
		expect(instanceScreen).toContain('contentInsetAdjustmentBehavior="never"');
		expect(instanceScreen).toContain("setSupportMultipleWindows={false}");
		expect(instanceScreen).toContain("hideKeyboardAccessoryView");
		expect(instanceScreen).toContain(
			"allowsBackForwardNavigationGestures={false}"
		);
		expect(instanceScreen).toContain("allowsLinkPreview={false}");
		expect(instanceScreen).toContain('dataDetectorTypes="none"');
		expect(instanceScreen).toContain('contentMode="mobile"');
		expect(instanceScreen).toContain(
			"const webviewCanGoBack = canGoBack || overlayBackActive"
		);
		expect(instanceScreen).toContain("composery:overlay-back:on");
		expect(instanceScreen).toContain("composery:overlay-back:off");
		expect(instanceScreen).toContain(
			"const resetTransientWebViewState = useCallback"
		);
		expect(instanceScreen).toContain(
			"const recoverWebViewProcess = useCallback"
		);
		expect(instanceScreen).toContain(
			"onContentProcessDidTerminate={recoverWebViewProcess}"
		);
		expect(instanceScreen).toContain(
			"onRenderProcessGone={recoverWebViewProcess}"
		);
		expect(instanceScreen).toContain("setCanGoBack(false)");
		expect(instanceScreen).toContain("setReloadKey((k) => k + 1)");
	});

	test("keeps extension webviews on the mobile viewport contract", () => {
		const series = readRepoFile("packages/ide/patches/series");
		const webviewPatch = readRepoFile(
			"packages/ide/patches/webview-mobile.diff"
		);

		expect(series.trimEnd().split(/\r?\n/)).toContain("webview-mobile.diff");
		expect(webviewPatch).toContain("ensureMobileViewport");
		expect(webviewPatch).toContain("requiredParts");
		expect(webviewPatch).toContain("missingParts");
		expect(webviewPatch).toContain("viewport.setAttribute('content'");
		expect(webviewPatch).toContain("interactive-widget=resizes-content");
		expect(webviewPatch).toContain("safe-area-inset-bottom");
		expect(webviewPatch).toContain("text-size-adjust: 100%");
		expect(webviewPatch).toContain("font-size: max(16px, 1em)");
		expect(webviewPatch).toContain(
			"sha256-m1DlJtsIJd46QuWYNcsaYIG1xI+9FyjKQu+cfp+zq5Q="
		);
		expect(webviewPatch).toContain(
			"sha256-QuKvm69B6hrBMqAqamLCTFil1rSacSLe4NEDTJs+FcQ="
		);
	});

	test("repairs extension webview viewport meta content at runtime", () => {
		expect(webviewViewportAfterEnsure()).toBe(
			"width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
		);
		expect(webviewViewportAfterEnsure("width=device-width")).toBe(
			"width=device-width, viewport-fit=cover, interactive-widget=resizes-content"
		);
		expect(
			webviewViewportAfterEnsure(
				"width=device-width, viewport-fit=cover, interactive-widget=resizes-content"
			)
		).toBe(
			"width=device-width, viewport-fit=cover, interactive-widget=resizes-content"
		);
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

	const extensionIds = [...extension.matchAll(/\bid:\s*"([a-z]+)"/g)].map(
		(match) => match[1]
	);
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
				`packages/ide/overlay/src/browser/media/agents/${id}.svg`
			);
			expect(existsSync(logo)).toBe(true);
		}
	});

	test("agent logos are accent-tinted via a CSS mask", () => {
		expect(welcome).toContain(
			"background-color: var(--vscode-textLink-foreground)"
		);
		expect(welcome).toContain(
			"url(./_static/src/browser/media/agents/${agent.id}.svg)"
		);
	});

	test("welcome card dispatches installs through the composery-agents command", () => {
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
		expect(extension).toContain(".rename(");
		expect(extension).toContain(".bak");
		expect(extension).toContain("await this.backup(");
	});

	test("creates file and folder shortcuts from dropped resources", () => {
		expect(extension).toContain(
			'this.dropMimeTypes = [TREE_MIME, "text/uri-list"]'
		);
		expect(extension).toContain("vscode.workspace.fs.stat");
		expect(extension).toContain("fileOrFolderShortcut");
		expect(extension).toContain("hasResourceShortcut");
	});
});
