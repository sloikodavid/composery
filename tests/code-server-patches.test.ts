import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

import { describe, expect, test } from "vitest";

import {
	extractAddedFunction,
	readRepoFile,
	repoRoot
} from "./support/patchSource.ts";

const PATCHES_DIR = "packages/ide/patches";
const ASSETS =
	"packages/ide/overlay/lib/vscode/out/vs/code/browser/workbench/workbench-assets";

// ---------------------------------------------------------------------------
// Patch stack lint: mechanical validity for every patch in the series.
// ---------------------------------------------------------------------------

const seriesNames = readRepoFile(`${PATCHES_DIR}/series`).trim().split(/\r?\n/);

describe("patch stack lint", () => {
	test("series and patch files match one to one", () => {
		const files = readdirSync(resolve(repoRoot, PATCHES_DIR))
			.filter((name) => name.endsWith(".diff"))
			.sort();
		expect([...seriesNames].sort()).toEqual(files);
		expect(new Set(seriesNames).size).toBe(seriesNames.length);
	});

	// The Docker build clones upstream by commit (no git context after COPY), so
	// the Dockerfile ARG duplicates the submodule pin; keep them from drifting.
	test("Dockerfile pins the same code-server commit as the submodule", () => {
		const dockerfile = readRepoFile("Dockerfile");
		const pinned = /^ARG CODE_SERVER_COMMIT=([0-9a-f]{40})$/m.exec(
			dockerfile
		)?.[1];
		const staged = execFileSync(
			"git",
			["ls-files", "-s", "packages/ide/upstream"],
			{ cwd: repoRoot, encoding: "utf8" }
		).match(/[0-9a-f]{40}/)?.[0];

		expect(pinned).toBeDefined();
		expect(pinned).toBe(staged);
	});

	test.each(seriesNames)("%s is pure LF", (name) => {
		const raw = readFileSync(resolve(repoRoot, PATCHES_DIR, name));
		expect(raw.includes("\r")).toBe(false);
	});

	// A truncated or hand-mangled hunk is the classic way a patch silently ships
	// less than it declares. Consume exactly the declared line counts per hunk,
	// then require the next line to leave diff-body territory.
	test.each(seriesNames)("%s hunk counts match their bodies", (name) => {
		const lines = readRepoFile(`${PATCHES_DIR}/${name}`).split("\n");
		let hunks = 0;

		for (let index = 0; index < lines.length; index++) {
			const header = lines[index]?.match(
				/^@@ -\d+(?:,(?<removed>\d+))? \+\d+(?:,(?<added>\d+))? @@/
			);
			if (!header?.groups) continue;

			hunks++;
			const label = `${name} hunk #${hunks}`;
			let removed = Number(header.groups.removed ?? 1);
			let added = Number(header.groups.added ?? 1);

			while (removed > 0 || added > 0) {
				index++;
				const line = lines[index];
				expect(line, `${label} body truncated`).toBeDefined();
				if (line!.startsWith("\\")) continue; // "\ No newline at end of file"
				if (line!.startsWith("+")) added--;
				else if (line!.startsWith("-")) removed--;
				else {
					added--;
					removed--;
				}
				expect(added, `${label} overran added count`).toBeGreaterThanOrEqual(0);
				expect(
					removed,
					`${label} overran removed count`
				).toBeGreaterThanOrEqual(0);
			}

			const next = lines[index + 1];
			const dangling =
				next !== undefined &&
				(next.startsWith("+") || next.startsWith("-")) &&
				!next.startsWith("+++") &&
				!next.startsWith("---");
			expect(dangling, `${label} leaves dangling diff lines`).toBe(false);
		}

		expect(hunks).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// narrow.js keyboard-inset behavior, executed in a browser-shaped VM.
// ---------------------------------------------------------------------------

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
	const narrowJs = readRepoFile(`${ASSETS}/narrow.js`);
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

describe("narrow overlay", () => {
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

	// Two independent small-screen gates: touch (hover/pointer) and narrow
	// (viewport width). Keyboard-inset logic belongs to the narrow overlay only;
	// the touch gate must never grow viewport knowledge.
	test("keeps the touch gate free of keyboard-inset logic", () => {
		const narrowJs = readRepoFile(`${ASSETS}/narrow.js`);
		const narrowCss = readRepoFile(`${ASSETS}/narrow.css`);
		const touchGatePatch = readRepoFile(`${PATCHES_DIR}/touch-gate.diff`);

		expect(narrowJs).toContain("bottomKeyboardOverlap");
		expect(narrowCss).toContain("--composery-touch-keyboard-inset");
		expect(touchGatePatch).toContain("TOUCH_QUERY");
		expect(touchGatePatch).not.toContain("keyboardInset");
		expect(touchGatePatch).not.toContain("bottomKeyboardOverlap");
	});

	// The touch-editor patch creates selection-handle elements that only the
	// touch overlay styles; the pair must name the same class.
	test("touch selection handles are styled by the touch overlay", () => {
		const touchEditorPatch = readRepoFile(`${PATCHES_DIR}/touch-editor.diff`);
		const touchCss = readRepoFile(`${ASSETS}/touch.css`);

		expect(touchEditorPatch).toContain("composery-touch-selection-handles");
		expect(touchCss).toContain(".composery-touch-selection-handle");
	});

	// Post-build, the workbench assets must be rsynced into the release bundle
	// or every narrow/touch behavior above silently vanishes from the image.
	test("build.sh ships the workbench assets into the release", () => {
		expect(readRepoFile("packages/ide/build.sh")).toContain(
			'rsync -a "$HERE/overlay/lib/vscode/out/" "$BUILD/release/lib/vscode/out/"'
		);
	});

	// narrow.js signals overlay-back state to the native app; the mobile WebView
	// listens for the same protocol strings.
	test("overlay-back protocol matches between narrow.js and the mobile app", () => {
		const narrowJs = readRepoFile(`${ASSETS}/narrow.js`);
		const instanceScreen = readRepoFile(
			"packages/mobile/src/app/instance/[id].tsx"
		);

		expect(narrowJs).toContain("composery:overlay-back:");
		expect(instanceScreen).toContain("composery:overlay-back:on");
		expect(instanceScreen).toContain("composery:overlay-back:off");
	});
});

// ---------------------------------------------------------------------------
// Mobile viewport contract: every HTML surface we serve declares the same
// viewport capabilities, and webviews repair theirs at runtime.
// ---------------------------------------------------------------------------

const VIEWPORT_PARTS = [
	"viewport-fit=cover",
	"interactive-widget=resizes-content"
];

describe("mobile viewport contract", () => {
	test.each([
		"packages/ide/overlay/src/browser/pages/error.html",
		"packages/ide/overlay/src/browser/pages/login.html",
		"packages/ide/overlay/src/browser/pages/register.html",
		"packages/ide/overlay/src/browser/pages/reset-password.html",
		"packages/ide/overlay/src/node/persistence/readiness.ts",
		`${PATCHES_DIR}/overlays.diff`,
		`${PATCHES_DIR}/webview-mobile.diff`
	])("%s declares the shared viewport parts", (path) => {
		const content = readRepoFile(path);
		for (const part of VIEWPORT_PARTS) {
			expect(content).toContain(part);
		}
	});

	test("workbench pages carry the viewport contract via overlays.diff", () => {
		const overlaysPatch = readRepoFile(`${PATCHES_DIR}/overlays.diff`);
		expect(overlaysPatch).toContain(
			"lib/vscode/src/vs/code/browser/workbench/callback.html"
		);
		expect(overlaysPatch).toContain(
			"lib/vscode/src/vs/code/browser/workbench/workbench-dev.html"
		);
	});
});

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
	const webviewPatch = readRepoFile(`${PATCHES_DIR}/webview-mobile.diff`);
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

describe("extension webviews", () => {
	test("repairs viewport meta content at runtime", () => {
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
});

// ---------------------------------------------------------------------------
// Agent setup: the welcome card (patch) and the composery-agents extension are
// two surfaces of one list; they must agree.
// ---------------------------------------------------------------------------

describe("composery agent setup", () => {
	const extension = readRepoFile(
		"packages/ide/overlay/lib/vscode/extensions/composery-agents/extension.js"
	);
	const welcome = readRepoFile(`${PATCHES_DIR}/welcome.diff`);

	const extensionIds = [...extension.matchAll(/\bid:\s*"([a-z]+)"/g)].map(
		(match) => match[1]
	);
	const welcomeIds = [...welcome.matchAll(/\{\s*id:\s*'([a-z]+)'/g)].map(
		(match) => match[1]
	);

	test("welcome card and extension cover the same agents in the same order", () => {
		expect(extensionIds.length).toBeGreaterThan(0);
		expect(welcomeIds).toEqual(extensionIds);
	});

	test("every agent ships a logo served from the welcome _static media path", () => {
		expect(welcome).toContain(
			"url(./_static/src/browser/media/agents/${agent.id}.svg)"
		);
		for (const id of extensionIds) {
			const logo = resolve(
				repoRoot,
				`packages/ide/overlay/src/browser/media/agents/${id}.svg`
			);
			expect(existsSync(logo)).toBe(true);
		}
	});

	test("welcome card dispatches installs through the composery-agents command", () => {
		expect(welcome).toContain(
			"this.commandService.executeCommand('composery.installAgent'"
		);
		expect(extension).toContain('registerCommand("composery.installAgent"');
	});
});

// ---------------------------------------------------------------------------
// Shortcuts: the extension, its manifest, and the workbench patch expose one
// command surface across three files.
// ---------------------------------------------------------------------------

describe("composery shortcuts", () => {
	const extension = readRepoFile(
		"packages/ide/overlay/lib/vscode/extensions/composery-shortcuts/extension.js"
	);
	const manifest = readRepoFile(
		"packages/ide/overlay/lib/vscode/extensions/composery-shortcuts/package.json"
	);
	const shortcutsPatch = readRepoFile(`${PATCHES_DIR}/shortcuts.diff`);

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

	test("implements every command the manifest contributes", () => {
		const parsed = JSON.parse(manifest) as {
			contributes: { commands: Array<{ command: string }> };
		};
		const commands = parsed.contributes.commands.map((entry) => entry.command);

		expect(commands.length).toBeGreaterThan(0);
		for (const command of commands) {
			expect(extension).toContain(`"${command}"`);
		}
	});
});
