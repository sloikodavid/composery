import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { posix, resolve } from "node:path";
import vm from "node:vm";

import { describe, expect, test } from "vitest";

import {
	addedLines,
	applyPatch,
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
	test("Dockerfile pins the same IDE upstream commit as the submodule", () => {
		const dockerfile = readRepoFile("Dockerfile");
		const pinned = /^ARG COMPOSERY_IDE_UPSTREAM_COMMIT=([0-9a-f]{40})$/m.exec(
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

	// Count lints cannot catch a hunk GNU patch refuses at fuzz=0 (context
	// drift, parser quirks) - only real application can, and the Docker build is
	// a slow place to find out. Rehearse the exact stack the build applies:
	// code-server's own series, then ours, in order, on a shadow tree fed from
	// the pristine upstream working copy.
	test(
		"the full patch stack applies with GNU patch at fuzz=0",
		{ timeout: 60_000 },
		() => {
			const upstream = resolve(repoRoot, "packages/ide/upstream");
			const shadow = mkdtempSync(resolve(tmpdir(), "composery-stack-"));

			const filesTouched = (patchText: string): string[] => {
				const files = new Set<string>();
				for (const line of patchText.split("\n")) {
					const header = /^(?:---|\+\+\+) (\S+)/.exec(line)?.[1];
					if (!header || header === "/dev/null") continue;
					// mimic -p1: strip the first path component (a/, code-server/, ...)
					const rel = header.split("/").slice(1).join("/");
					if (rel) files.add(rel);
				}
				return [...files];
			};

			const applySeries = (seriesDir: string) => {
				const series = readFileSync(resolve(seriesDir, "series"), "utf8")
					.trim()
					.split(/\r?\n/)
					.filter((line) => line && !line.startsWith("#"));
				for (const name of series) {
					const patchFile = resolve(seriesDir, name);
					for (const rel of filesTouched(readFileSync(patchFile, "utf8"))) {
						const dst = resolve(shadow, rel);
						const src = resolve(upstream, rel);
						if (!existsSync(dst) && existsSync(src)) {
							mkdirSync(posix.dirname(dst.replaceAll("\\", "/")), {
								recursive: true
							});
							copyFileSync(src, dst);
						}
					}
					try {
						applyPatch(patchFile, shadow);
					} catch (error) {
						const output = error as { stdout?: string; stderr?: string };
						expect.fail(
							`${name} does not apply at fuzz=0:\n${output.stdout ?? ""}${output.stderr ?? ""}`
						);
					}
				}
			};

			try {
				applySeries(resolve(upstream, "patches"));
				applySeries(resolve(repoRoot, PATCHES_DIR));
			} finally {
				rmSync(shadow, { recursive: true, force: true });
			}
		}
	);
});

describe("local media preview", () => {
	test("keeps uploaded media binary and outside the workspace", () => {
		const source = addedLines(
			readRepoFile(`${PATCHES_DIR}/local-media-preview.diff`)
		);

		expect(source).toContain("if (contents && getMediaMime(resource.path))");
		expect(source).toContain("scheme: Schemas.tmp");
		expect(source).toContain(
			"await this.fileService.writeFile(resource, contents)"
		);
		expect(source).toContain("contents = undefined");
		expect(source).toContain("await this.editorService.openEditors(editors)");
	});
});

// The workbench half of the QR is a patch, the rendering half is a shipped
// extension. Top-level function declarations in a vm context land on the context
// object, so the extension's internals are reachable without test-only exports.
function loadQrExtension(): {
	isReachableFromAnotherDevice: (url: URL) => boolean;
	render: (url: string) => string;
} {
	const source = readRepoFile(
		"packages/ide/overlay/lib/vscode/extensions/composery-qr/extension.js"
	);
	const nodeRequire = createRequire(import.meta.url);
	const context: Record<string, unknown> = vm.createContext({
		URL,
		module: { exports: {} },
		require(name: string): unknown {
			if (name === "vscode") return { commands: {}, window: {} };
			if (name === "node:os") return { networkInterfaces: () => ({}) };
			if (name === "./qrcode-generator.js") {
				return nodeRequire(
					resolve(
						repoRoot,
						"packages/ide/overlay/lib/vscode/extensions/composery-qr/qrcode-generator.js"
					)
				) as unknown;
			}
			throw new Error(`Unexpected require: ${name}`);
		}
	});

	vm.runInContext(source, context);

	expect(context.isReachableFromAnotherDevice).toBeTypeOf("function");
	expect(context.render).toBeTypeOf("function");
	return {
		isReachableFromAnotherDevice: context.isReachableFromAnotherDevice as (
			url: URL
		) => boolean,
		render: context.render as (url: string) => string
	};
}

describe("QR action", () => {
	// startup() is awaited by the workbench, and code-server supports running
	// embedded, where window.top belongs to someone else and throws on access.
	test("resolves the address without touching the embedder", () => {
		const source = addedLines(readRepoFile(`${PATCHES_DIR}/qr-action.diff`));

		expect(source).toContain(
			"new URL(this.productService.rootEndpoint || '.', window.location.href).href"
		);
		expect(source).not.toContain("window.top");
		// The handler's promise must reach the command service, or a missing
		// extension host fails the menu item silently.
		expect(source).toContain(
			"return accessor.get(ICommandService).executeCommand('composery.showQr'"
		);
		// Both registrations return disposables that belong to the client.
		expect(source).toContain(
			"this._register(CommandsRegistry.registerCommand("
		);
		expect(source).toContain("this._register(MenuRegistry.appendMenuItem(");
	});

	test("refuses addresses another device cannot reach", () => {
		const { isReachableFromAnotherDevice } = loadQrExtension();

		for (const reachable of [
			"https://box.test/",
			"http://192.168.1.192:8080/",
			// A hostname is not a prefix match: 127.example.com is somebody's domain.
			"http://127.example.com/"
		]) {
			expect(isReachableFromAnotherDevice(new URL(reachable)), reachable).toBe(
				true
			);
		}

		for (const unreachable of [
			"http://localhost:8080/",
			"http://box.localhost/",
			"http://localhost./",
			"http://127.0.0.1:8080/",
			"http://127.1:8080/",
			"http://2130706433:8080/",
			"http://0.0.0.0:8080/",
			"http://[::1]/",
			"http://[::]/",
			// IPv4-mapped loopback, which the URL parser hands over as ::ffff:7f00:1.
			"http://[::ffff:127.0.0.1]/",
			"ftp://box.test/"
		]) {
			expect(
				isReachableFromAnotherDevice(new URL(unreachable)),
				unreachable
			).toBe(false);
		}
	});

	// A short LAN address makes a low-version code with wide modules, so a quiet
	// zone measured in layout pixels shrinks exactly when it matters most.
	test("carries the spec's four-module quiet zone at every version", () => {
		const { render } = loadQrExtension();

		for (const url of [
			"http://192.168.1.192:8080/",
			"https://a-much-longer-name.boxes.composery.app/?folder=/home/user/src"
		]) {
			const svg = render(url);
			const size = Number(/viewBox="0 0 (\d+) \1"/.exec(svg)?.[1]);
			// The finder pattern owns module (0, 0), so the first move in the path
			// is offset from the edge by exactly the quiet zone.
			const quietZone = Number(/<path d="M(\d+),/.exec(svg)?.[1]);

			expect(quietZone / 8, url).toBe(4);
			expect(size, url).toBeGreaterThan(quietZone * 2);
		}
	});

	test("sizes the QR card against the viewport, not device guesses", () => {
		const extension = readRepoFile(
			"packages/ide/overlay/lib/vscode/extensions/composery-qr/extension.js"
		);

		// A percentage min-height does not resolve against an auto-height <html>,
		// which left the card pinned to the top of the tab.
		expect(extension).toContain("min-height: 100dvh;");
		expect(extension).not.toContain("min-height: 100%");
		expect(extension).toContain(
			"width: min(288px, 100%, calc(100dvh - 10rem));"
		);
		expect(extension).not.toContain("100vh");
		expect(extension).not.toContain("@media");
		expect(extension).toContain("env(safe-area-inset-top, 0px)");
		// The page cannot rely on webview-mobile.diff injecting a viewport for it.
		expect(extension).toContain('name="viewport"');
	});

	test("reuses one panel instead of stacking tabs", () => {
		const extension = readRepoFile(
			"packages/ide/overlay/lib/vscode/extensions/composery-qr/extension.js"
		);

		expect(extension).toContain("panel.reveal(panel.viewColumn, false)");
		expect(extension).toContain("if (rendered !== url.href)");
	});
});

describe("cloud password setup", () => {
	test("keeps self-hosted registration and gates cloud registration", () => {
		const authPatch = readRepoFile(`${PATCHES_DIR}/auth.diff`);
		const register = readRepoFile(
			"packages/ide/overlay/src/node/routes/register.ts"
		);

		expect(authPatch).toContain(
			'app.router.use("/_composery/cloud", cloudAuthRoute.router)'
		);
		expect(authPatch).toContain(
			'cloudConfig ? "_composery/cloud/authorize" : "register"'
		);
		expect(register).toContain("cloudConfig && hasCloudSetupGrant(req)");
		expect(register).toContain("await installCloudPassword");
	});

	test("binds the cloud callback with PKCE and restricted cookies", () => {
		const cloudAuth = readRepoFile(
			"packages/ide/overlay/src/node/routes/cloudAuth.ts"
		);

		expect(cloudAuth).toContain('createHash("sha256")');
		expect(cloudAuth).toContain('searchParams.set("code_challenge"');
		expect(cloudAuth).toContain('searchParams.set("state"');
		expect(cloudAuth).toContain("httpOnly: true");
		expect(cloudAuth).toContain("secure: true");
		expect(cloudAuth).toContain('sameSite: "lax"');
		expect(cloudAuth).toContain("/api/cloud/auth/exchange");
	});

	test("renders authorization failures through the shared auth error slot", () => {
		const cloudAuth = readRepoFile(
			"packages/ide/overlay/src/node/routes/cloudAuth.ts"
		);
		const fields = readRepoFile(
			"packages/ide/overlay/src/browser/pages/cloud-error-fields.html"
		);

		expect(cloudAuth).toContain(
			'error: "Cloud authorization could not finish."'
		);
		expect(fields).not.toContain("auth-message");
		expect(fields).toContain('class="submit-button"');
	});
});

describe("soft-keyboard enter", () => {
	test("replays IME line-break commits as cancelable Enter keydowns", () => {
		const source = addedLines(readRepoFile(`${PATCHES_DIR}/touch-enter.diff`));

		// Both commit shapes, touch-gated, real events only, never mid-composition.
		expect(source).toContain(
			"if (!isTouch(window) || !e.isTrusted || e.isComposing) {"
		);
		expect(source).toContain(
			"if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') {"
		);
		// A trusted Enter keydown already reached every listener - no replay.
		expect(source).toContain(
			"e.timeStamp - lastTrustedEnter < TRUSTED_ENTER_WINDOW_MS"
		);
		// xterm feeds the pty from input events itself - replaying would double up.
		expect(source).toContain("target.closest('.xterm')");
		// StandardKeyboardEvent maps from the legacy fields the constructor drops.
		expect(source).toContain("keyCode: { value: 13 }");
		expect(source).toContain("which: { value: 13 }");
		// The line-break insertion is cancelled only when a consumer handled the replay.
		expect(source).toContain("if (!target.dispatchEvent(keydown)) {");
		// Installed for the main window and every future auxiliary window.
		expect(source).toContain("Event.runAndSubscribe(onDidRegisterWindow");
		expect(source).toContain("this._register(new ImeEnterFallback());");
	});

	test("asks soft keyboards for a newline key on single-line inputs", () => {
		const patch = readRepoFile(`${PATCHES_DIR}/touch-enter.diff`);

		// Must be a key that commits a line break, because that commit is the only
		// thing ImeEnterFallback can replay. An action key ("go"/"send") renders as
		// Gboard's right arrow and emits nothing at all, disabling the fallback.
		expect(addedLines(patch)).toContain(
			"this.input.setAttribute('enterkeyhint', 'enter');"
		);
		for (const actionKey of ["'go'", "'send'", "'done'", "'search'"]) {
			expect(addedLines(patch)).not.toContain(`'enterkeyhint', ${actionKey}`);
		}
		// Only the single-line <input> branch gets the hint - the flexibleHeight
		// textarea keeps its newline return key (context line, not an added one).
		expect(patch).toContain(
			" \t\t\tthis.input.type = this.options.type || 'text';"
		);
	});

	test("quick input text prompts get a tap path that bypasses the IME", () => {
		const source = addedLines(readRepoFile(`${PATCHES_DIR}/touch-enter.diff`));

		// The OK button feeds the same accept emitter Enter does; showing it on
		// touch guarantees submission even when the IME emits no event at all.
		expect(source).toContain("ok: isTouch(dom.getWindow(this.ui.container)),");
	});
});

describe("touch link activation", () => {
	test("terminal taps hit-test detected links and skip word links", () => {
		const source = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-terminal-links.diff`)
		);

		// Words are everywhere; a tap must keep meaning "focus the terminal".
		expect(source).toContain("['url', 'localFile', 'localFolder'] as const");
		expect(source).not.toContain("'word'");
		// The same modifier-exempt activation path as the link quick pick.
		expect(source).toContain(
			"link.activate(new TerminalLinkQuickPickEvent(EventType.CLICK), link.text);"
		);
		// Any click that reaches a link on a touch screen is deliberate.
		expect(source).toContain("if (isTouch(getWindow(this._xterm.element))) {");
		// Tap listening waits for the terminal DOM and only ever engages on touch.
		expect(source).toContain(
			"const screen = xterm.raw.element?.querySelector('.xterm-screen');"
		);
		// Long-press fallback that reaches every detected link, not just tappable ones.
		expect(source).toContain("MenuId.TerminalInstanceContext");
	});

	test("editor context menu offers Open Link only while the cursor is on one", () => {
		const source = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-editor-links.diff`)
		);

		expect(source).toContain(
			"new RawContextKey<boolean>('composeryCursorOnLink', false)"
		);
		// Bound on touch only, so desktop menus never change.
		expect(source).toContain(
			"if (isTouch(getWindow(editor.getContainerDomNode()))) {"
		);
		expect(source).toContain(
			"this.cursorOnLink?.set(!!this.getLinkOccurrence(this.editor.getPosition()));"
		);
		expect(source).toContain("command: { id: 'editor.action.openLink'");
		expect(source).toContain("when: CURSOR_ON_LINK");
	});

	test("rendered-markdown links activate on Tap inside Gesture targets", () => {
		const source = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-markdown-links.diff`)
		);

		expect(source).toContain("if (isTouch(DOM.getWindow(outElement))) {");
		expect(source).toContain("Gesture.addTarget(outElement)");
		expect(source).toContain("TouchEventType.Tap");
		// Tap resolves the anchor from the touched node, not the dispatch target.
		expect(source).toContain("DOM.isHTMLElement(e.initialTarget)");
	});
});

describe("touch inline actions", () => {
	test("lists, tables and trees stand down on taps consumed by inline controls", () => {
		const source = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-inline-actions.diff`)
		);

		const guards = source.match(
			/e\.browserEvent\.type === TouchEventType\.Tap && e\.browserEvent\.defaultPrevented/g
		);
		// onViewPointer + onDoubleClick in listWidget, onViewPointer in abstractTree.
		expect(guards).toHaveLength(3);
	});

	test("hover-revealed action bars stay visible on touch", () => {
		const css = readRepoFile(`${ASSETS}/touch.css`);

		for (const surface of [
			".quick-input-list-entry-action-bar",
			".pane-header.expanded > .actions",
			".custom-view-tree-node-item",
			".scm-view",
			".open-editors",
			".debug-pane",
			".markers-panel",
			".comments-panel",
			".keybindings-table-container",
			".setting-toolbar-container"
		]) {
			expect(css).toContain(surface);
		}
		expect(css).toContain(".tabs-list .actions");
	});

	test("notebook insert-cell toolbars are reachable on touch", () => {
		const css = readRepoFile(`${ASSETS}/touch.css`);

		// The two hover-only insert affordances: the per-notebook top bar and the
		// focused cell's insert-below bar. The title toolbar and run button already
		// reveal on .focused, so they are deliberately not forced here.
		expect(css).toContain(".cell-list-top-cell-toolbar-container");
		expect(css).toContain(
			"> .monaco-list-row.focused\n\t\t.cell-bottom-toolbar-container"
		);
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
}): {
	properties: Map<string, string>;
	setVisualViewportHeight(height: number): void;
	fireVisualViewportResize(): void;
} {
	const narrowJs = readRepoFile(`${ASSETS}/narrow.js`);
	const properties = new Map<string, string>();
	const visualViewportListeners: { type: string; listener: () => void }[] = [];
	const viewportObject = visualViewport
		? {
				addEventListener(type: string, listener: () => void) {
					visualViewportListeners.push({ type, listener });
				},
				height: visualViewport.height,
				offsetTop: visualViewport.offsetTop,
				width: visualViewport.width ?? 390
			}
		: undefined;
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
			visualViewport: viewportObject
		}
	});
	vm.runInContext(narrowJs, context);

	return {
		properties,
		setVisualViewportHeight(height: number) {
			if (viewportObject) {
				viewportObject.height = height;
			}
		},
		fireVisualViewportResize() {
			for (const { type, listener } of visualViewportListeners) {
				if (type === "resize") {
					listener();
				}
			}
		}
	};
}

describe("narrow overlay", () => {
	test("computes keyboard inset from actual bottom overlap", () => {
		expect(
			runNarrowViewportVars({
				visualViewport: { height: 520, offsetTop: 0 }
			}).properties.get("--composery-touch-keyboard-inset")
		).toBe("280px");

		expect(
			runNarrowViewportVars({
				virtualKeyboard: { bottom: 800, height: 280, y: 520 },
				visualViewport: { height: 800, offsetTop: 0 }
			}).properties.get("--composery-touch-keyboard-inset")
		).toBe("280px");

		expect(
			runNarrowViewportVars({
				envInset: 220,
				visualViewport: { height: 800, offsetTop: 0 }
			}).properties.get("--composery-touch-keyboard-inset")
		).toBe("220px");

		expect(
			runNarrowViewportVars({
				virtualKeyboard: { bottom: 500, height: 200, y: 300 },
				visualViewport: { height: 800, offsetTop: 0 }
			}).properties.get("--composery-touch-keyboard-inset")
		).toBe("0px");
	});

	// The workbench layout listener (touch-viewport-inset.diff) registers after
	// narrow.js on the same visualViewport and reads
	// --composery-touch-keyboard-inset within the same resize delivery. The vars
	// must update synchronously in narrow.js's geometry listeners: an
	// animation-frame update hands the layout a stale keyboard inset and wedges
	// the workbench at the keyboard-open height after the keyboard closes. The
	// harness stubs requestAnimationFrame as a no-op, so only the sync path can
	// pass this test.
	test("viewport vars update synchronously within the resize delivery", () => {
		const run = runNarrowViewportVars({
			visualViewport: { height: 800, offsetTop: 0 }
		});
		expect(run.properties.get("--composery-touch-keyboard-inset")).toBe("0px");

		run.setVisualViewportHeight(520);
		run.fireVisualViewportResize();
		expect(run.properties.get("--composery-touch-keyboard-inset")).toBe(
			"280px"
		);

		run.setVisualViewportHeight(800);
		run.fireVisualViewportResize();
		expect(run.properties.get("--composery-touch-keyboard-inset")).toBe("0px");
	});

	// With interactive-widget=resizes-content the keyboard also resizes the layout
	// viewport, and its final at-rest geometry can arrive as a window resize after
	// the last visualViewport event of the animation. Listening only to
	// visualViewport leaves the workbench wedged at the keyboard-open height
	// (verified live on Android Chrome); both viewports must drive layout().
	test("keyboard layout listens to the layout viewport as well", () => {
		const viewportPatch = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-viewport-inset.diff`)
		);

		expect(viewportPatch).toContain("if (viewport !== mainWindow) {");
		expect(viewportPatch).toContain(
			"this._register(addDisposableListener(mainWindow, EventType.RESIZE, () => {"
		);
	});

	// Android may resize visualViewport and report the same keyboard through the
	// native bridge. The layout must consume one signal, never subtract both.
	test("does not double-subtract a resized viewport and native keyboard inset", () => {
		const viewportPatch = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-viewport-inset.diff`)
		);

		expect(viewportPatch).toContain(
			"const nativeOnlyKeyboardOverlap = viewportKeyboardOverlap > 0 ? 0 : nativeKeyboardOverlap"
		);
		expect(viewportPatch).toContain(
			"Math.round(viewport.height) - nativeOnlyKeyboardOverlap - safeAreaBottom"
		);
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

	// The touch-editor patch creates the caret drag handle that only the touch
	// overlay styles; the pair must name the same class. Range selection handles
	// are the browser's own (native selection) and must not come back as custom
	// elements.
	test("touch caret handle is styled by the touch overlay", () => {
		const touchEditorPatch = readRepoFile(`${PATCHES_DIR}/touch-editor.diff`);
		const touchCss = readRepoFile(`${ASSETS}/touch.css`);

		expect(touchEditorPatch).toContain("composery-touch-caret-handle");
		expect(touchCss).toContain(".composery-touch-caret-handle");
		expect(touchEditorPatch).not.toContain("composery-touch-selection-handle");
		expect(touchCss).not.toContain("composery-touch-selection-handle");
	});

	// Native mobile text selection: the browser creates it (long-press on now-
	// selectable lines), the editor mirrors it into the model, and the clipboard
	// payload comes from the model - rendered spans use no-break spaces and stop
	// at the rendered viewport, so a DOM copy would corrupt the text.
	test("native selection is unblocked, synced, and clipboard-owned", () => {
		const gesturePatch = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-native-selection.diff`)
		);
		const touchEditorPatch = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-editor.diff`)
		);
		const touchCss = readRepoFile(`${ASSETS}/touch.css`);

		// Gesture stands down from preventDefault inside the zone (start, and moves
		// still inside the tap-cancel slop); everywhere else keeps it.
		expect(gesturePatch).toContain(
			"public static nativeSelectionZone(element: HTMLElement): IDisposable"
		);
		expect(gesturePatch).toContain("if (!allNativeZone) {");
		expect(gesturePatch).toContain(
			"nativeStationary = nativeStationary && !!data && data.nativeZone && !data.tapCancelled;"
		);

		// The editor registers the zone, mirrors selectionchange into the model and
		// owns the copy payload.
		expect(touchEditorPatch).toContain(
			"Gesture.nativeSelectionZone(this.viewHelper.linesContentDomNode)"
		);
		expect(touchEditorPatch).toContain("'selectionchange'");
		expect(touchEditorPatch).toContain("generateDataToCopyAndStoreInMemory");

		// Chromium only selects what user-select allows, and Monaco stays the single
		// selection painter - the browser's own highlight is made transparent.
		expect(touchCss).toContain("user-select: text !important");
		expect(touchCss).toContain(
			".monaco-workbench .monaco-editor .view-lines ::selection"
		);
	});

	// Android fires a real contextmenu while its long-press starts the native
	// selection and again when a handle drag ends; neither may open the IDE menu.
	// The IDE menu on touch comes from the in-selection hold timer instead - armed
	// on Start and surviving the browser's touchcancel takeover.
	test("IDE context menu is arbitrated around the native selection", () => {
		const touchEditorPatch = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-editor.diff`)
		);

		expect(touchEditorPatch).toContain(
			"if (isAndroid && this._lastPointerType === 'touch'"
		);
		expect(touchEditorPatch).toContain(
			"gesture.startedOnText && !gesture.startedInSelection"
		);
		expect(touchEditorPatch).toContain(
			"if (gesture.canceled && gesture.menuTimer !== undefined)"
		);
	});

	// A pan can start on editor padding as well as rendered text. It must be
	// classified before the synthetic tap path focuses the hidden editor input,
	// and keyboard-driven layout changes must preserve the current scroll.
	test("touch editor scrolling does not focus or reveal on keyboard resize", () => {
		const touchEditorPatch = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-editor.diff`)
		);

		expect(touchEditorPatch).toContain(
			"Math.hypot(this._touchGesture.totalX, this._touchGesture.totalY) >= TOUCH_PAN_THRESHOLD"
		);
		expect(touchEditorPatch).toContain("this._touchGesture.panned = true");
		expect(touchEditorPatch).toContain(
			"if (this._touchGesture?.panned || this._touchGesture?.menuOpened)"
		);
		expect(touchEditorPatch).toContain("if (!keyboardVisible");
		expect(touchEditorPatch).not.toContain("revealAllCursors");
		// One definition of "touch" in the editor: the per-interaction pointer
		// type. A second device-level gate here was redundant with it.
		expect(touchEditorPatch).not.toContain("isTouchDevice");
	});

	// Inertia Change events carry the gesture owner (touch-context-menu.diff gives
	// them an initialTarget so submenu flicks stop at their own menu), so the
	// editor cannot identify them by a missing initialTarget. The live-gesture
	// check is the one that works: Gesture dispatches End (which nulls
	// _touchGesture) before any inertia frame, while real finger moves always
	// follow a Start. Keying on initialTarget made the suppression dead code and
	// a fast selection or handle-drag release flung the editor.
	test("editor inertia suppression keys on the live gesture, not initialTarget", () => {
		const touchEditorPatch = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-editor.diff`)
		);

		expect(touchEditorPatch).toContain(
			"if (!this._touchGesture && Date.now() < this._suppressTouchInertiaUntil)"
		);
		expect(touchEditorPatch).not.toContain(
			"!event.initialTarget && Date.now() < this._suppressTouchInertiaUntil"
		);
	});

	// Upstream picks PointerEventHandler only for phone UAs (isIOS, or isAndroid
	// with the "Mobi" token). Android tablets and touch laptops then fall back to
	// the legacy TouchHandler, which has none of the touch selection, handle and
	// context-menu support - so the gate must be the canonical touch gate.
	test("PointerEventHandler is gated on the touch gate, not the phone UA", () => {
		const touchEditorPatch = readRepoFile(`${PATCHES_DIR}/touch-editor.diff`);

		expect(addedLines(touchEditorPatch)).toContain(
			"if (isTouch(mainWindow) && BrowserFeatures.pointerEvents)"
		);
		expect(touchEditorPatch).toContain(
			"-\t\tconst isPhone = platform.isIOS || (platform.isAndroid && platform.isMobile);"
		);
	});

	// PointerEventHandler handles presses from pointerdown, whose preventDefault
	// suppresses the compat mousedown that carries the browser's click count -
	// double/triple-click word and line select would never see count 2/3. Mouse
	// presses must fall through to the base MouseHandler's mousedown flow.
	test("mouse presses skip the pointerdown path so click counts survive", () => {
		const touchEditorPatch = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-editor.diff`)
		);

		expect(touchEditorPatch).toContain(
			"if ((e.browserEvent as PointerEvent).pointerType === 'mouse' && e.browserEvent.type === 'pointerdown')"
		);
	});

	// Parts restored visible at boot fire no visibility event, so the first
	// narrow layout pass sees no intent. Without seeding it from the restored
	// layout, that pass closes the part the user left open - and a reviving
	// background view (the reattaching terminal) can then steal the fullscreen.
	test("narrow-fullscreen boot pass seeds intent from the restored layout", () => {
		const layoutPatch = addedLines(
			readRepoFile(`${PATCHES_DIR}/narrow-fullscreen.diff`)
		);

		expect(layoutPatch).toContain(
			"this.narrowPart ??= Layout.NARROW_PARTS.find(part => this.isVisible(part))"
		);
	});

	// Post-build, the workbench assets must be rsynced into the release bundle
	// or every narrow/touch behavior above silently vanishes from the image.
	test("build.sh ships the workbench assets into the release", () => {
		expect(readRepoFile("packages/ide/scripts/build.sh")).toContain(
			'rsync -a "$PACKAGE_ROOT/overlay/lib/vscode/out/" "$BUILD/release/lib/vscode/out/"'
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

	// Rotation can make a phone wider than the narrow layout breakpoint while
	// Android hardware Back still needs to dismiss dialogs and menus in the IDE.
	test("overlay back guards survive wide coarse-pointer orientation", () => {
		const narrowJs = readRepoFile(`${ASSETS}/narrow.js`);

		expect(narrowJs).toContain('window.matchMedia("(pointer: coarse)")');
		expect(narrowJs).toContain(
			"if (!narrow.matches && !coarsePointer.matches)"
		);
	});

	// A back gesture with a narrow-fullscreen part open must close the part, not
	// leave the page: narrow.js dispatches the close event and the layout patch
	// listens for it - same literal on both sides or back exits the IDE.
	test("narrow close-part event matches between narrow.js and the layout patch", () => {
		const narrowJs = readRepoFile(`${ASSETS}/narrow.js`);
		const layoutPatch = readRepoFile(`${PATCHES_DIR}/narrow-fullscreen.diff`);

		expect(narrowJs).toContain('"composery-narrow-close-part"');
		expect(addedLines(layoutPatch)).toContain("'composery-narrow-close-part'");
	});

	test("narrow rotation preserves the part selected on mobile", () => {
		const layoutPatch = addedLines(
			readRepoFile(`${PATCHES_DIR}/narrow-fullscreen.diff`)
		);

		expect(layoutPatch).toContain("if (this.inNarrowPartTransition)");
		expect(layoutPatch).toContain("desktopPartVisibility.add(this.narrowPart)");
	});

	test("mobile extension features keep wide table columns reachable", () => {
		const extensionsPatch = addedLines(
			readRepoFile(`${PATCHES_DIR}/extensions-mobile.diff`)
		);
		const narrowCss = readRepoFile(`${ASSETS}/narrow.css`);

		expect(extensionsPatch).toContain("select.composery-feature-picker");
		expect(extensionsPatch).toContain(
			"{ horizontal: ScrollbarVisibility.Auto }"
		);
		expect(narrowCss).toContain(".extension-editor .feature-body-content");
		expect(narrowCss).toMatch(
			/\.composery-feature-picker \{[\s\S]*?display: none;[\s\S]*?\}\s*\.composery-feature-picker\.visible \{\s*display: block;/
		);
		expect(narrowCss).toContain("overflow-x: auto !important");
		expect(narrowCss).toContain("touch-action: pan-x pan-y !important");
		// The left region must fit the logo + menubar margin + the real 38px
		// overflow button; anything less spills the button under the command
		// center. The menubar itself must stay the zero-basis flexer from
		// titlebar-menubar-overflow.diff (its allocated width is what triggers
		// overflow mode), so narrow.css must not width-force it.
		expect(narrowCss).toMatch(
			/> \.titlebar-left \{[\s\S]*?min-width: 77px !important;/
		);
		expect(narrowCss).not.toContain(".menubar.overflow-menu-only");
	});

	test("short touch layouts keep the terminal keybar inside the viewport", () => {
		const compactFooterPatch = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-compact-footer.diff`)
		);
		const keybarPatch = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-terminal-keybar.diff`)
		);
		const narrowCss = readRepoFile(`${ASSETS}/narrow.css`);

		expect(compactFooterPatch).toContain(
			"isTouch(getWindow(this.contentArea))"
		);
		expect(compactFooterPatch).toContain("composery-compact-footer");
		expect(keybarPatch).toContain("this.minimumBodySize = this._keybar.height");
		expect(narrowCss).toContain(".part.composery-compact-footer > .footer");
	});

	// narrow.js detects an open part via the workbench part-hidden classes; those
	// literals belong to upstream layout.ts and must survive upstream bumps.
	test("narrow.js part-hidden classes exist upstream", () => {
		const narrowJs = readRepoFile(`${ASSETS}/narrow.js`);
		const layoutTs = readRepoFile(
			"packages/ide/upstream/lib/vscode/src/vs/workbench/browser/layout.ts"
		);

		for (const hiddenClass of ["nosidebar", "nopanel", "noauxiliarybar"]) {
			expect(narrowJs).toContain(`"${hiddenClass}"`);
			expect(layoutTs).toContain(`'${hiddenClass}'`);
		}
	});

	// The sash grab-area default must key off the canonical touch gate (not a
	// second hardcoded query, and not iOS-only like upstream).
	test("touch-sash patch keys the sash size default off the touch gate", () => {
		const sashPatch = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-sash.diff`)
		);

		expect(sashPatch).toContain("touchGate.js");
		expect(sashPatch).toContain("isTouch(mainWindow) ? 20 : 4");
	});

	// Native selects on touch have exactly one decision point - the SelectBox
	// constructor, where touch overrides even an explicit useCustomDrawn - so no
	// call-site override can quietly bring the custom-drawn list back.
	test("touch-select patch keys the native-select decision off the touch gate", () => {
		const rawPatch = readRepoFile(`${PATCHES_DIR}/touch-select.diff`);
		const selectPatch = addedLines(rawPatch);

		expect(selectPatch).toContain(
			"isTouch(mainWindow) || (isMacintosh && !selectBoxOptions?.useCustomDrawn)"
		);
		expect(selectPatch).not.toContain("useCustomDrawn:");
		// A native select must receive the untouched browser touchstart. Registering
		// it with Gesture causes preventDefault(), which suppresses the OS picker.
		expect(rawPatch).toContain(
			"-\t\tthis._register(Gesture.addTarget(this.selectElement));"
		);
		expect(selectPatch).not.toContain("Gesture.addTarget(this.selectElement)");
		// Removing our own target is not enough: an ANCESTOR Gesture target (the
		// panel title area hosting the terminal switcher) also preventDefault()s the
		// touch, so the select must be a Gesture ignore-target to open at all.
		expect(selectPatch).toContain("Gesture.ignoreTarget(this.selectElement)");
	});

	// The welcome page wires everything through plain click listeners upstream, and
	// a Gesture target's touchend preventDefault() suppresses the synthesized click
	// for the whole subtree - Gesture-targeting the slides made the entire page
	// tap-dead. Touch scrolling is native overflow instead, mirrored back into the
	// DomScrollableElement so wheel scrolling stays consistent.
	test("welcome page scrolls natively on touch and stays clickable", () => {
		const welcome = readRepoFile(`${PATCHES_DIR}/welcome.diff`);
		const welcomeAdded = addedLines(welcome);

		expect(welcomeAdded).not.toContain("Gesture.addTarget");
		expect(welcomeAdded).toContain("overflow-y: auto !important;");
		expect(welcomeAdded).toContain(
			"getScrollbar()?.setScrollPosition({ scrollTop: element.scrollTop, scrollLeft: element.scrollLeft })"
		);
		// The narrow layout allocates a welcome header row; upstream's
		// width-constrained display:none must not win or the branding vanishes.
		expect(readRepoFile(`${ASSETS}/narrow.css`)).toMatch(
			/> \.header \{\s*display: block !important;/
		);
	});

	// The logo SVG colours itself from the browser scheme (prefers-color-scheme in
	// the SVG), which the IDE theme does not control and app WebViews report
	// wrongly - the titlebar icon must be a mask filled from a titlebar theme
	// colour, with no theme-class fork left behind.
	test("titlebar logo is masked with the titlebar foreground for every theme", () => {
		const logoPatch = readRepoFile(`${PATCHES_DIR}/titlebar-logo.diff`);
		const logoAdded = addedLines(logoPatch);

		expect(logoAdded).toContain(
			"background-color: var(--vscode-titleBar-activeForeground);"
		);
		expect(logoAdded).toContain(
			"mask: url('../../../media/code-icon.svg') center center / 20px no-repeat;"
		);
		expect(logoPatch).not.toContain("composery-theme");
		expect(logoAdded).not.toContain("background-size: 20px");
	});

	// Phone browsers are detected as fullscreen, where upstream pads the menubar
	// (4px 5px) instead of its 4px margin - shifting the overflow button 5px right
	// and clipping it against the 77px titlebar-left pin. narrow.css must normalize
	// the fullscreen geometry back to the pinned math.
	test("narrow titlebar pin holds in fullscreen", () => {
		expect(readRepoFile(`${ASSETS}/narrow.css`)).toMatch(
			/\.monaco-workbench\.fullscreen[\s\S]*?> \.menubar:not\(\.compact\) \{\s*margin-left: 4px;\s*padding: 0;/
		);
	});

	// Re-opening the already-visible editor (tapping the same extension in the
	// marketplace) fires no visible-editors change, so upstream's showEditorIfHidden
	// never runs and the fullscreen part reads as tap-dead. The will-open event
	// fires for every request, deduped or not.
	test("narrow fullscreen exits on any editor open request", () => {
		expect(
			addedLines(readRepoFile(`${PATCHES_DIR}/narrow-fullscreen.diff`))
		).toContain("this.mainPartEditorService.onWillOpenEditor(() => {");
	});

	// The extension editor header is a nowrap flex row upstream; long names clipped
	// at the header's hidden overflow on phones instead of wrapping.
	test("extension editor header wraps on narrow viewports", () => {
		expect(readRepoFile(`${ASSETS}/narrow.css`)).toMatch(
			/> \.title \{\s*flex-wrap: wrap;/
		);
	});

	// The editor's in-selection menu hold must fire before Gesture's during-hold
	// fallback, or the fallback would dispatch a second context menu for the same
	// press before the editor marks the gesture as consumed.
	test("editor menu hold time stays below the gesture hold delay", () => {
		const selectionHold = Number(
			/TOUCH_SELECTION_MENU_HOLD_TIME = (\d+)/.exec(
				addedLines(readRepoFile(`${PATCHES_DIR}/touch-editor.diff`))
			)?.[1]
		);
		const gestureHold = Number(
			/HOLD_DELAY = (\d+)/.exec(
				readRepoFile(
					"packages/ide/upstream/lib/vscode/src/vs/base/browser/touch.ts"
				)
			)?.[1]
		);

		expect(selectionHold).toBeGreaterThan(0);
		expect(gestureHold).toBeGreaterThan(0);
		expect(selectionHold).toBeLessThan(gestureHold);
	});

	// Both patches encode the same device-verified "finger moved enough that this
	// is a pan, not a tap" magnitude: the editor's pan threshold and the gesture
	// tap-cancel slop. The native-selection move exemption keys on the same slop,
	// so a drift would let stationary-window moves reach the browser after the
	// editor already started panning. They live in different files - pin them.
	test("editor pan threshold matches the gesture tap-cancel slop", () => {
		const selectionThreshold = Number(
			/TOUCH_PAN_THRESHOLD = (\d+)/.exec(
				addedLines(readRepoFile(`${PATCHES_DIR}/touch-editor.diff`))
			)?.[1]
		);
		const tapCancelSlop = Number(
			/data\.initialPageY - touch\.pageY\) >= (\d+)/.exec(
				addedLines(readRepoFile(`${PATCHES_DIR}/touch-context-menu.diff`))
			)?.[1]
		);

		expect(selectionThreshold).toBeGreaterThan(0);
		expect(selectionThreshold).toBe(tapCancelSlop);
	});

	// Android Chrome re-opens a dismissed on-screen keyboard when a touch gesture ends
	// while an editable holds focus - and the terminal and the editor both keep a hidden
	// textarea focused. Panning either with the keyboard down popped it back up and the
	// resize ate the pan. The suppression must hang off the same pan decision that cancels
	// the tap, and only a tap may hand the keyboard back.
	test("a pan stands the on-screen keyboard down until the next tap", () => {
		const patch = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-keyboard-reopen.diff`)
		);

		// inputmode="none" is the only attribute that suppresses the re-open.
		expect(patch).toContain("active.setAttribute('inputmode', 'none')");
		// Only editables - nothing else can raise a keyboard.
		expect(patch).toContain("DomUtils.isEditableElement(active)");
		// Released on the tap, before the tap's handlers focus anything.
		expect(patch).toContain("this.allowKeyboardReopen();");
		// A pre-existing inputmode belongs to whoever set it: save and restore it
		// rather than clobbering it to the default.
		expect(patch).toContain("active.getAttribute('inputmode')");
		expect(patch).toContain("element.setAttribute('inputmode', inputMode)");

		// The trigger is the pan decision itself, so the threshold can never drift
		// apart from the tap-cancel slop it rides on.
		const panPatch = readRepoFile(`${PATCHES_DIR}/touch-keyboard-reopen.diff`);
		expect(panPatch).toContain("data.tapCancelled = true;");
		expect(panPatch).toContain(
			"+\t\t\t\tthis.suppressKeyboardReopen(data.initialTarget);"
		);
	});

	// Long-press menus fire during the hold (Gesture timer), and editor context
	// menus render in the light DOM on touch, where the overlay touch styling
	// cannot pierce a shadow root. A pan remains a pan through release and inertia;
	// it must never fall back into the synthetic tap path or reach ancestor menus.
	test("touch-context-menu patch fires during the hold and widens the shadow gate", () => {
		const patch = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-context-menu.diff`)
		);

		expect(patch).toContain("contextMenuTimer");
		expect(patch).toContain("tapCancelled");
		expect(patch).toContain("!data.tapCancelled && holdTime");
		expect(patch).toContain(
			"this.newGestureEvent(EventType.Change, initialTarget)"
		);
		expect(patch).toContain(
			"EditorOption.useShadowDOM) && !isTouch(mainWindow)"
		);
		// The OS cancels touches on app switch; without touchcancel cleanup the
		// stale entries kill the single-touch checks (long-press, inertia) forever.
		expect(patch).toContain("'touchcancel'");
		// The hold itself can re-render the pressed DOM (the editor word-selects
		// mid-hold) and detach initialTarget; dispatch then finds no containing
		// Gesture target and silently drops the menu. The timer must re-resolve
		// the live element under the finger.
		expect(patch).toContain("!data.initialTarget.isConnected");
		expect(patch).toContain("elementFromPoint");
	});

	// Most workbench surfaces (the terminal, the titlebar, empty editor groups) open
	// their menus from native contextmenu listeners that a long-press never reaches:
	// Gesture targets preventDefault the touchstart and iOS synthesizes no contextmenu
	// at all. An unconsumed gesture context event must be re-fired as a real bubbling
	// contextmenu from the touched element - and the semantic owners that do consume
	// must open their own menus.
	test("long-press falls back to a native contextmenu when no gesture owner consumes", () => {
		const patch = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-context-menu.diff`)
		);

		// touch.ts: the fallback fires only for unconsumed gesture context events...
		expect(patch).toContain("if (!holdEvt.defaultPrevented) {");
		expect(patch).toContain("if (!evt.defaultPrevented) {");
		expect(patch).toContain(
			"new MouseEvent('contextmenu', { bubbles: true, cancelable: true"
		);
		// ...never for editable fields (the OS selection toolbar owns those)...
		expect(patch).toContain("DomUtils.isEditableElement(target)");
		// ...and a release-time native echo (Windows fires its contextmenu on
		// finger-up) must not double the menu, while a during-hold native one
		// (Android outside Gesture targets) stands the timer down instead.
		expect(patch).toContain("suppressNativeContextMenuUntil");
		expect(patch).toContain("e.stopImmediatePropagation()");

		// Some engines follow an unprevented long-press release with an emulated-mouse
		// tap that would land on the open menu's blocking overlay and dismiss it - the
		// echo batch must be swallowed, but a fresh touch ends the suppression.
		expect(patch).toContain("onReleaseMouseEcho");
		expect(patch).toContain("this.suppressNativeContextMenuUntil = 0;");

		// The fallback is the ONLY workbench-part touch path: part-level gesture
		// context menu listeners would shadow deeper native owners (a toolbar button's
		// item menu), and a second listView leg would emit every touch menu twice. The
		// patch must remove them, not add more.
		const removedLines = readRepoFile(`${PATCHES_DIR}/touch-context-menu.diff`)
			.split("\n")
			.filter((line) => line.startsWith("-") && !line.startsWith("---"))
			.join("\n");
		for (const removed of [
			"addDisposableListener(parent, TouchEventType.Contextmenu",
			"addDisposableListener(titleArea, GestureEventType.Contextmenu",
			"addDisposableListener(area, GestureEventType.Contextmenu",
			"addDisposableListener(tabsContainer, TouchEventType.Contextmenu",
			"addDisposableListener(tab, TouchEventType.Contextmenu",
			"new DomEmitter(this.domNode, TouchEventType.Contextmenu)"
		]) {
			expect(removedLines).toContain(removed);
			expect(patch).not.toContain(removed);
		}
	});

	// window.ts blocks native contextmenus AND TextInputActionsProvider shows a themed input
	// menu - together they suppress the OS text-selection toolbar on touch, where it is the
	// better fit for a plain field and is what iOS shows anyway. Both must step aside for a real
	// editable control on touch; the code editor keeps its gesture menu (hidden input excluded),
	// and mouse/desktop keeps the themed menu.
	test("touch routes real editable controls to the native selection toolbar", () => {
		const patch = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-input-context-menu.diff`)
		);

		expect(patch).toContain(
			"isTouch(getWindow(this.layoutService.mainContainer))"
		);
		expect(patch).toContain("isEditableElement(target)");
		expect(patch).toContain("!target.classList.contains('inputarea')");
		expect(patch).toContain(
			"!target.classList.contains('native-edit-context')"
		);
		expect(patch).toContain("if (isTouch(targetWindow)) {");
		expect(patch).toContain("EventHelper.stop(e, true)");
	});

	test("nested menus retain focus and home actions stay at the File root", () => {
		const touchMenu = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-menu.diff`)
		);
		const homeActions = addedLines(
			readRepoFile(`${PATCHES_DIR}/menu-home-actions.diff`)
		);

		expect(touchMenu).toContain("EventType.FOCUS_IN");
		expect(touchMenu).toContain("this.hideScheduler.cancel()");
		expect(homeActions).toContain("includeWebNavigation = true");
		expect(homeActions).toContain(
			"updateActions(menuItem.actions, submenuActions, topLevelTitle, store, false)"
		);
	});

	// Upstream's focus tracking samples document.hasFocus() only on four events
	// and latches the value; a WebView resume restores focus without any of them,
	// wedging the workbench inactive (gray title bar, IME suppressed). The
	// resample patch must keep both healing sources: interaction, and the
	// visible-poll upstream itself uses for auxiliary windows.
	test("window-focus-resample patch samples interaction and late focus", () => {
		const patch = addedLines(
			readRepoFile(`${PATCHES_DIR}/window-focus-resample.diff`)
		);

		expect(patch).toContain("'pointerdown'");
		expect(patch).toContain("disposableWindowInterval");
	});

	// The two gates are defined once in the gate patches but mirrored - CSS and
	// overlay JS cannot import TS - in touch.css/.js, narrow.css/.js, and the
	// webview iframe CSS. Extract the canonical values from the gate patches and
	// require every mirror to match, so a query or breakpoint tweak cannot drift.
	test("overlay assets and patches mirror the canonical gate queries", () => {
		const touchQuery = /TOUCH_QUERY = '([^']+)'/.exec(
			readRepoFile(`${PATCHES_DIR}/touch-gate.diff`)
		)?.[1];
		const narrowWidth = /NARROW_MAX_WIDTH = (\d+)/.exec(
			readRepoFile(`${PATCHES_DIR}/narrow-gate.diff`)
		)?.[1];
		expect(touchQuery).toBeDefined();
		expect(narrowWidth).toBeDefined();

		const touchMedia = readRepoFile(`${ASSETS}/touch.css`)
			.split("\n")
			.filter((line) => line.startsWith("@media"));
		expect(touchMedia.length).toBeGreaterThan(0);
		for (const line of touchMedia) {
			expect(line).toBe(`@media ${touchQuery} {`);
		}
		expect(readRepoFile(`${ASSETS}/touch.js`)).toContain(`"${touchQuery}"`);

		const narrowMedia = readRepoFile(`${ASSETS}/narrow.css`)
			.split("\n")
			.filter((line) => line.startsWith("@media"));
		expect(narrowMedia.length).toBeGreaterThan(0);
		for (const line of narrowMedia) {
			expect(line).toBe(`@media (max-width: ${narrowWidth}px) {`);
		}
		expect(readRepoFile(`${ASSETS}/narrow.js`)).toContain(
			`NARROW_MAX_WIDTH = ${narrowWidth}`
		);
		expect(readRepoFile(`${PATCHES_DIR}/webview-mobile.diff`)).toContain(
			`@media (max-width: ${narrowWidth}px)`
		);
	});

	// A wrong relative import path in a patch (or a stale one after the gate file
	// moves) only explodes at Docker-build time. Resolve every touchGate import
	// the stack adds against the file the gate patch actually creates.
	test("every patched touchGate import resolves to the gate file", () => {
		const gateFile = "lib/vscode/src/vs/base/browser/touchGate.ts";
		expect(readRepoFile(`${PATCHES_DIR}/touch-gate.diff`)).toContain(
			`+++ b/${gateFile}`
		);

		let imports = 0;
		for (const name of seriesNames) {
			let target = "";
			for (const line of readRepoFile(`${PATCHES_DIR}/${name}`).split("\n")) {
				const file = /^\+\+\+ b\/(.+)$/.exec(line);
				if (file?.[1]) target = file[1];

				const imported = /^\+import .* from '(\S*touchGate\.js)';$/.exec(line);
				const importPath = imported?.[1];
				if (!importPath) continue;

				imports++;
				expect(
					posix.join(posix.dirname(target), importPath),
					`${name} imports touchGate from ${target}`
				).toBe(gateFile.replace(/\.ts$/, ".js"));
			}
		}
		expect(imports).toBeGreaterThan(0);
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
		"packages/ide/overlay/src/browser/pages/auth.html",
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

describe("adaptive favicon", () => {
	test.each([
		"packages/ide/overlay/src/browser/pages/auth.html",
		"packages/ide/overlay/src/browser/pages/error.html",
		`${PATCHES_DIR}/overlays.diff`
	])(
		"%s declares the sized ICO fallback before the adaptive SVG favicon",
		(path) => {
			const raw = readRepoFile(path);
			const content = path.endsWith(".diff") ? addedLines(raw) : raw;

			// ICO first with an explicit sizes attribute, adaptive SVG last with
			// sizes="any": Chromium picks an unsized or later-listed ICO over the
			// SVG and the tab icon stops following the colour scheme. The ICO
			// stays declared for browsers, webviews and bookmark/crawler services
			// without SVG-favicon support.
			const ico = content.indexOf("favicon.ico");
			const svg = content.indexOf("favicon.svg");
			expect(ico).toBeGreaterThan(-1);
			expect(svg).toBeGreaterThan(ico);
			expect(content).toContain('type="image/x-icon"');
			expect(content).toContain('sizes="32x32"');
			expect(content).toContain('type="image/svg+xml"');
			expect(content).toContain('sizes="any"');
			expect(content).not.toContain("alternate icon");
		}
	);

	test("generated adaptive favicon uses an internal color-scheme media query", () => {
		const favicon = readRepoFile(
			"packages/ide/overlay/src/browser/media/favicon.svg"
		);

		expect(favicon).toContain("@media (prefers-color-scheme:dark)");
		expect(favicon).toContain("currentColor");
		expect(favicon).not.toContain('media="(prefers-color-scheme');
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

	test("only overrides undo when the shortcuts view has a removal to restore", () => {
		const parsed = JSON.parse(manifest) as {
			contributes: {
				keybindings: Array<{ command: string; key: string; when: string }>;
			};
		};
		const undo = parsed.contributes.keybindings.find(
			(entry) => entry.command === "composery.shortcuts.undoRemove"
		);

		expect(undo).toEqual(
			expect.objectContaining({
				key: "ctrl+z",
				when: "focusedView == composery.shortcuts.view && composery.shortcuts.canUndoRemove"
			})
		);
		expect(extension).toContain('"setContext", CAN_UNDO_REMOVE_CONTEXT, true');
		expect(extension).toContain('"setContext", CAN_UNDO_REMOVE_CONTEXT, false');
	});
});

// ---------------------------------------------------------------------------
// API keys: exercise the shipped CommonJS extension with a mocked VS Code API
// and a mocked composery CLI.
// ---------------------------------------------------------------------------

type ApiKeysHarness = {
	clipboard: string[];
	commands: Map<string, () => Promise<void>>;
	errors: string[];
	execCalls: string[][];
	warnings: string[];
};

function loadApiKeysExtension({
	env = {},
	inputText,
	modalAction,
	picks = [],
	responses = []
}: {
	env?: Record<string, string>;
	inputText?: string;
	modalAction?: string;
	picks?: string[];
	responses?: unknown[];
}): { run: () => Promise<void>; harness: ApiKeysHarness } {
	const extension = readRepoFile(
		"packages/ide/overlay/lib/vscode/extensions/composery-api/extension.js"
	);
	const harness: ApiKeysHarness = {
		clipboard: [],
		commands: new Map(),
		errors: [],
		execCalls: [],
		warnings: []
	};
	const vscode = {
		commands: {
			registerCommand(name: string, callback: () => Promise<void>) {
				harness.commands.set(name, callback);
				return { dispose() {} };
			}
		},
		env: {
			clipboard: {
				writeText(text: string) {
					harness.clipboard.push(text);
					return Promise.resolve();
				}
			}
		},
		window: {
			showErrorMessage(message: string) {
				harness.errors.push(message);
				return Promise.resolve(undefined);
			},
			showInformationMessage() {
				return Promise.resolve(modalAction);
			},
			showInputBox() {
				return Promise.resolve(inputText);
			},
			showQuickPick(items: Array<{ label: string }>) {
				const pick = picks.shift();
				return Promise.resolve(
					pick === undefined
						? undefined
						: items.find((item) => item.label === pick)
				);
			},
			showWarningMessage(message: string) {
				harness.warnings.push(message);
				return Promise.resolve(modalAction);
			}
		}
	};
	const cjsModule: {
		exports: { activate?: (context: { subscriptions: unknown[] }) => void };
	} = { exports: {} };
	const context = vm.createContext({
		module: cjsModule,
		process: { env },
		require(name: string) {
			if (name === "vscode") return vscode;
			if (name === "child_process") {
				return {
					execFile(
						command: string,
						args: string[],
						options: unknown,
						callback: (error: null, stdout: string, stderr: string) => void
					) {
						harness.execCalls.push([command, ...args]);
						callback(null, JSON.stringify(responses.shift()), "");
					}
				};
			}
			throw new Error(`Unexpected require: ${name}`);
		}
	});

	vm.runInContext(extension, context);

	expect(cjsModule.exports.activate).toBeDefined();
	cjsModule.exports.activate!({ subscriptions: [] });
	const command = harness.commands.get("composery.manageApiKeys");
	expect(command).toBeDefined();
	return { harness, run: () => command!() };
}

describe("composery api keys", () => {
	const extension = readRepoFile(
		"packages/ide/overlay/lib/vscode/extensions/composery-api/extension.js"
	);
	const manifest = JSON.parse(
		readRepoFile(
			"packages/ide/overlay/lib/vscode/extensions/composery-api/package.json"
		)
	) as {
		activationEvents: string[];
		contributes: { commands: Array<{ command: string }> };
		extensionKind: string[];
	};

	test("manifest, extension, and home-menu patch expose one command surface", () => {
		expect(manifest.extensionKind).toContain("workspace");
		expect(manifest.activationEvents).toContain(
			"onCommand:composery.manageApiKeys"
		);
		expect(manifest.contributes.commands).toContainEqual(
			expect.objectContaining({ command: "composery.manageApiKeys" })
		);
		expect(extension).toContain('"composery.manageApiKeys"');
		expect(
			addedLines(readRepoFile(`${PATCHES_DIR}/api-keys-action.diff`))
		).toContain("id: 'composery.manageApiKeys'");
	});

	test("creating a key runs the CLI and copies the secret on request", async () => {
		const { harness, run } = loadApiKeysExtension({
			inputText: "ci",
			modalAction: "Copy Key",
			picks: ["$(add) Create API Key"],
			responses: [
				{ keys: [] },
				{
					created_at: 1752710400,
					id: "k1",
					name: "ci",
					prefix: "csy_abcd1234",
					secret: "csy_secret"
				},
				{
					keys: [
						{
							created_at: 1752710400,
							id: "k1",
							name: "ci",
							prefix: "csy_abcd1234"
						}
					]
				}
			]
		});

		await run();

		expect(harness.execCalls).toEqual([
			["composery", "api", "key", "list", "--json"],
			["composery", "api", "key", "create", "--name", "ci", "--json"],
			["composery", "api", "key", "list", "--json"]
		]);
		expect(harness.clipboard).toEqual(["csy_secret"]);
		expect(harness.errors).toEqual([]);
	});

	test("revoking asks first and passes the picked key id", async () => {
		const { harness, run } = loadApiKeysExtension({
			modalAction: "Revoke",
			picks: ["ci"],
			responses: [
				{
					keys: [
						{
							created_at: 1752710400,
							id: "k1",
							name: "ci",
							prefix: "csy_abcd1234"
						}
					]
				},
				{ id: "k1", revoked: true },
				{ keys: [] }
			]
		});

		await run();

		expect(harness.warnings[0]).toBe('Revoke API key "ci"?');
		expect(harness.execCalls[1]).toEqual([
			"composery",
			"api",
			"key",
			"revoke",
			"k1",
			"--json"
		]);
	});

	test("a dismissed confirmation revokes nothing", async () => {
		const { harness, run } = loadApiKeysExtension({
			picks: ["ci"],
			responses: [
				{
					keys: [
						{
							created_at: 1752710400,
							id: "k1",
							name: "ci",
							prefix: "csy_abcd1234"
						}
					]
				},
				{
					keys: [
						{
							created_at: 1752710400,
							id: "k1",
							name: "ci",
							prefix: "csy_abcd1234"
						}
					]
				}
			]
		});

		await run();

		expect(harness.execCalls.map((call) => call[3])).toEqual(["list", "list"]);
	});

	test("warns when the API is disabled, with the server's flag literal", async () => {
		expect(
			readRepoFile("packages/ide/overlay/src/node/routes/api/config.ts")
		).toContain("COMPOSERY_API_ENABLED");
		expect(extension).toContain("COMPOSERY_API_ENABLED");

		const { harness, run } = loadApiKeysExtension({
			env: { COMPOSERY_API_ENABLED: "false" },
			responses: [{ keys: [] }]
		});

		await run();

		expect(harness.warnings[0]).toContain("COMPOSERY_API_ENABLED=false");
	});
});

// ---------------------------------------------------------------------------
// Updates: exercise the shipped CommonJS extension with a mocked VS Code API.
// ---------------------------------------------------------------------------

type UpdatesRelease = {
	html_url?: string;
	prerelease?: boolean;
	tag_name?: string;
};

type UpdatesHarness = {
	commands: Map<string, () => void>;
	fetchCalls: string[];
	messages: string[];
	opened: string[];
};

function loadUpdatesExtension({
	action,
	release,
	source = "https://github.com/sloikodavid/composery.git",
	version = "1.2.3"
}: {
	action?: string;
	release?: UpdatesRelease;
	source?: string;
	version?: string;
}): {
	activate: (context: { subscriptions: unknown[] }) => void;
	harness: UpdatesHarness;
} {
	const extension = readRepoFile(
		"packages/ide/overlay/lib/vscode/extensions/composery-updates/extension.js"
	);
	const commands = new Map<string, () => void>();
	const harness: UpdatesHarness = {
		commands,
		fetchCalls: [],
		messages: [],
		opened: []
	};
	const vscode = {
		StatusBarAlignment: { Right: 2 },
		Uri: {
			parse(value: string) {
				return { toString: () => value };
			}
		},
		commands: {
			registerCommand(name: string, callback: () => void) {
				commands.set(name, callback);
				return { dispose() {} };
			}
		},
		env: {
			openExternal(uri: { toString(): string }) {
				harness.opened.push(uri.toString());
				return Promise.resolve(true);
			}
		},
		window: {
			showInformationMessage(message: string) {
				harness.messages.push(message);
				return Promise.resolve(action);
			},
			showWarningMessage(message: string) {
				harness.messages.push(message);
				return Promise.resolve(undefined);
			}
		}
	};
	const cjsModule: {
		exports: {
			activate?: (context: { subscriptions: unknown[] }) => void;
		};
	} = { exports: {} };
	const context = vm.createContext({
		AbortSignal: { timeout: () => ({}) },
		fetch: (url: string) => {
			harness.fetchCalls.push(url);
			return Promise.resolve({
				ok: release !== undefined,
				json() {
					return Promise.resolve(release);
				}
			});
		},
		module: cjsModule,
		process: {
			env: {
				COMPOSERY_BUILD_SOURCE: source,
				COMPOSERY_BUILD_VERSION: version
			}
		},
		require(name: string) {
			if (name === "vscode") return vscode;
			throw new Error(`Unexpected require: ${name}`);
		}
	});

	vm.runInContext(extension, context);

	expect(cjsModule.exports.activate).toBeDefined();
	return {
		activate: (context) => cjsModule.exports.activate!(context),
		harness
	};
}

async function flushUpdatesExtension(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("composery updates", () => {
	const extension = readRepoFile(
		"packages/ide/overlay/lib/vscode/extensions/composery-updates/extension.js"
	);
	const manifest = JSON.parse(
		readRepoFile(
			"packages/ide/overlay/lib/vscode/extensions/composery-updates/package.json"
		)
	) as {
		activationEvents: string[];
		contributes: { commands: Array<{ command: string }> };
		extensionKind: string[];
	};

	test("manifest and extension expose the check command on startup", () => {
		expect(manifest.activationEvents).toContain("onStartupFinished");
		expect(manifest.extensionKind).toContain("workspace");
		expect(manifest.contributes.commands).toContainEqual(
			expect.objectContaining({ command: "composery.checkForUpdates" })
		);
		expect(extension).toContain('registerCommand("composery.checkForUpdates"');
		expect(extension).not.toContain("createStatusBarItem");
		// updates.diff owns the whole update surface: the File-menu item firing
		// the extension command, and the removal of code-server's own notifier
		// (no second update mechanism may survive anywhere in the stack).
		const updates = readRepoFile(`${PATCHES_DIR}/updates.diff`);
		const updatesAdded = addedLines(updates);
		expect(updatesAdded).toContain("id: 'composery.checkForUpdates'");
		expect(updatesAdded).toContain("order: -2");
		expect(updates).toContain("-\t\tif (this.productService.updateEndpoint) {");
		expect(updatesAdded).not.toContain("updateEndpoint");
		const qrAction = readRepoFile(`${PATCHES_DIR}/qr-action.diff`);
		expect(qrAction).not.toContain("checkForUpdates");
		expect(readRepoFile(`${PATCHES_DIR}/branding.diff`)).not.toContain(
			"checkUpdates"
		);
	});

	test("startup check announces a newer stable release and opens it", async () => {
		const { activate, harness } = loadUpdatesExtension({
			action: "View Release",
			release: {
				html_url:
					"https://github.com/sloikodavid/composery/releases/tag/v1.3.0",
				prerelease: false,
				tag_name: "v1.3.0"
			}
		});

		activate({ subscriptions: [] });
		await flushUpdatesExtension();

		expect(harness.fetchCalls).toEqual([
			"https://api.github.com/repos/sloikodavid/composery/releases/latest"
		]);
		expect(harness.messages).toEqual([
			"Composery 1.3.0 is available. You have 1.2.3."
		]);
		expect(harness.opened).toEqual([
			"https://github.com/sloikodavid/composery/releases/tag/v1.3.0"
		]);
	});

	test("manual check reports when the stable build is already current", async () => {
		const { activate, harness } = loadUpdatesExtension({
			release: {
				html_url:
					"https://github.com/sloikodavid/composery/releases/tag/v1.2.3",
				prerelease: false,
				tag_name: "v1.2.3"
			}
		});

		activate({ subscriptions: [] });
		await flushUpdatesExtension();
		harness.commands.get("composery.checkForUpdates")?.();
		await flushUpdatesExtension();

		expect(harness.messages).toEqual(["Composery 1.2.3 is up to date."]);
		expect(harness.opened).toEqual([]);
	});

	test("manual check stays local for preview builds", async () => {
		const { activate, harness } = loadUpdatesExtension({
			version: "preview-abc123"
		});

		activate({ subscriptions: [] });
		await flushUpdatesExtension();
		harness.commands.get("composery.checkForUpdates")?.();
		await flushUpdatesExtension();

		expect(harness.fetchCalls).toEqual([]);
		expect(harness.messages).toEqual([
			"You have development build preview-abc123. Updates are checked automatically in stable releases."
		]);
	});

	test("manual check explains an unversioned development build", async () => {
		const { activate, harness } = loadUpdatesExtension({ version: "unknown" });

		activate({ subscriptions: [] });
		await flushUpdatesExtension();
		harness.commands.get("composery.checkForUpdates")?.();
		await flushUpdatesExtension();

		expect(harness.fetchCalls).toEqual([]);
		expect(harness.messages).toEqual([
			"This development build has no release version. Updates are checked automatically in stable releases."
		]);
	});

	test("manual check distinguishes a failed stable-release check", async () => {
		const { activate, harness } = loadUpdatesExtension({});

		activate({ subscriptions: [] });
		await flushUpdatesExtension();
		harness.commands.get("composery.checkForUpdates")?.();
		await flushUpdatesExtension();

		expect(harness.messages).toEqual([
			"Couldn't check for updates. You have Composery 1.2.3. Try again later."
		]);
	});
});

describe("product icon themes", () => {
	test("late-loaded fonts repaint product icons on Android Chromium", () => {
		const source = addedLines(
			readRepoFile(`${PATCHES_DIR}/product-icon-themes.diff`)
		);

		expect(source).toContain("font-display: swap");
		expect(source).not.toContain("font-display: block");
	});
});

describe("default color theme", () => {
	const themeServiceRel =
		"lib/vscode/src/vs/workbench/services/themes/common/workbenchThemeService.ts";

	const themeColors = (file: string): Record<string, string> =>
		(
			JSON.parse(
				readRepoFile(
					`packages/ide/overlay/lib/vscode/extensions/composery-themes/themes/${file}`
				)
			) as { colors: Record<string, string> }
		).colors;

	// Apply the patch alone onto the pristine upstream file, so the assertions
	// run against exactly what the build tree contains after quilt.
	const patchedThemeService = (): string => {
		const shadow = mkdtempSync(resolve(tmpdir(), "composery-theme-"));
		try {
			const dst = resolve(shadow, themeServiceRel);
			mkdirSync(posix.dirname(dst.replaceAll("\\", "/")), { recursive: true });
			copyFileSync(
				resolve(repoRoot, "packages/ide/upstream", themeServiceRel),
				dst
			);
			applyPatch(
				resolve(repoRoot, PATCHES_DIR, "default-color-theme.diff"),
				shadow
			);
			return readFileSync(dst, "utf8").replaceAll("\r\n", "\n");
		} finally {
			rmSync(shadow, { recursive: true, force: true });
		}
	};

	const patched = patchedThemeService();

	test("Composery themes are the ThemeSettingDefaults", () => {
		expect(patched).toContain(
			"export const COLOR_THEME_DARK = 'Composery Dark';"
		);
		expect(patched).toContain(
			"export const COLOR_THEME_LIGHT = 'Composery Light';"
		);
	});

	// The INITIAL_COLORS blocks are upstream's synchronous first-paint snapshot
	// of the default themes (themes load async from extension JSON). The patch
	// retints them by hand; this keeps the retint honest against the theme
	// JSONs. Keys the themes do not define keep upstream's values.
	test.each([
		["COLOR_THEME_DARK_INITIAL_COLORS", "composery-dark.json"],
		["COLOR_THEME_LIGHT_INITIAL_COLORS", "composery-light.json"]
	])("%s first paint agrees with %s", (constant, themeFile) => {
		const block = new RegExp(
			`export const ${constant} = \\{\\n([\\s\\S]*?)\\n\\};`
		).exec(patched)?.[1];
		expect(block).toBeDefined();

		const colors = themeColors(themeFile);
		let compared = 0;
		for (const line of block!.split("\n")) {
			const entry = /^\t'([^']+)': '([^']*)',?$/.exec(line);
			if (!entry) continue;
			const key = entry[1]!;
			if (!(key in colors)) continue;
			compared++;
			expect(entry[2], key).toBe(colors[key]);
		}
		expect(compared).toBeGreaterThan(100);
	});

	// The theme JSONs are hand-authored; only where they genuinely share the
	// brand palette must they match it (a check instead of a generator). The
	// palette is read from the generated web brand.css, which sync.mjs --check
	// pins to packages/shared/index.ts.
	const brandTokens = (selector: string): Record<string, string> => {
		const block = new RegExp(`${selector} \\{([\\s\\S]*?)\\}`).exec(
			readRepoFile("packages/web/app/brand.css")
		)?.[1];
		expect(block).toBeDefined();
		return Object.fromEntries(
			[...block!.matchAll(/--([\w-]+): ([^;]+);/g)].map((entry) => [
				entry[1]!,
				entry[2]!
			])
		);
	};

	test.each([
		["composery-dark.json", "\\.dark"],
		["composery-light.json", ":root"]
	])("%s matches the brand palette where they overlap", (file, selector) => {
		const colors = themeColors(file);
		const brand = brandTokens(selector);

		expect(colors["editor.background"]).toBe(brand["background"]);
		expect(colors["editor.foreground"]).toBe(brand["foreground"]);
		expect(colors["button.background"]).toBe(brand["primary"]);
		expect(colors["button.foreground"]).toBe(brand["primary-foreground"]);
		expect(colors["activityBar.background"]).toBe(brand["background"]);
		expect(colors["editorGroup.border"]).toBe(brand["border"]);
	});
});

describe("terminal edge padding", () => {
	// The padding patch only works because upstream's row fit subtracts the
	// xterm element's computed CSS padding (the same mechanism as the built-in
	// 20px gutter). If a bump drops that, the padding would clip the grid
	// instead of reserving space.
	test("upstream row fit still subtracts computed padding", () => {
		const instance = readRepoFile(
			"packages/ide/upstream/lib/vscode/src/vs/workbench/contrib/terminal/browser/terminalInstance.ts"
		);
		expect(instance).toContain(
			"parseInt(computedStyle.paddingTop) + parseInt(computedStyle.paddingBottom)"
		);
	});

	test("patch pads the shared .xterm rule top and bottom", () => {
		const added = addedLines(
			readRepoFile(`${PATCHES_DIR}/terminal-padding.diff`)
		);
		expect(added).toContain("padding-top: 4px;");
		expect(added).toContain("padding-bottom: 4px;");
	});
});

describe("terminal keyboard occlusion", () => {
	const patch = readRepoFile(
		`${PATCHES_DIR}/touch-terminal-keyboard-occlusion.diff`
	);

	// The normal buffer holds scrollback and a scroll position that belong to the user,
	// and resizing it reflows the content and shifts ydisp - the "teleports to the very
	// top unless I was at the very bottom" in the report. The keyboard must not disturb
	// it: keep the grid at its keyboard-down size and occlude the bottom of it.
	test("the grid is sized against the keyboard-down pane height", () => {
		const added = addedLines(patch);

		// Both sizing entry points go through the stable height, not the live one.
		expect(patch).toContain(
			"+		this._evaluateColsAndRows(width, this._stableGridHeight(width, height));"
		);
		expect(added).toContain(
			"const terminalWidth = this._evaluateColsAndRows(dimension.width, this._stableGridHeight(dimension.width, dimension.height));"
		);

		// The remembered height is only refreshed while the keyboard is down, and a
		// rotation (width change) invalidates it.
		expect(added).toContain("'--composery-touch-keyboard-open'");
		expect(added).toContain(
			"} else if (this._stableGrid?.width !== width || height >= this._stableGrid.height) {"
		);

		// The opening keyboard shrinks the viewport before it is far enough along for
		// narrow.js to call it a keyboard. Committing those frames would bake the
		// half-open height into the grid, so a shrink only counts once it outlives the
		// animation - measured as a 648px grid collapsing to 590px without this.
		expect(added).toContain(
			"this._stableGridShrink.value = disposableTimeout("
		);
		expect(added).toContain("this._stableGridShrink.clear();");

		// Touch only - a desktop window must keep resizing its pty as before.
		expect(added).toContain(
			"if (!isTouch(dom.getWindow(this._wrapperElement))) {"
		);
		expect(added).toContain("return height;");
	});

	// The alternate screen is the other half of the rule and the reason it is a rule
	// rather than a special case: it carries no scrollback and no scroll position, so
	// there is nothing to preserve by occluding it - and nothing to scroll to either,
	// which would strand any UI above the fold (OpenCode centres its input, and at 18
	// rows it lays out logo, input, hints and footer all visible). Hand it the size that
	// is really on screen and let the app lay itself out.
	test("the alternate screen is resized, not occluded", () => {
		const added = addedLines(patch);

		expect(added).toContain(
			"if (raw && raw.buffer.active === raw.buffer.alternate) {"
		);
		expect(added).toContain(
			"this._wrapperElement.classList.remove('composery-terminal-occluded');"
		);

		// A buffer switch changes which half of the rule applies, so the grid has to be
		// re-evaluated - otherwise a full-screen app entered with the keyboard up keeps
		// the shell's taller grid and draws below the fold.
		expect(added).toContain("xterm.raw.buffer.onBufferChange(() => {");
		expect(added).toContain("this._initDimensions();");

		// Sub-row pane/grid differences are layout noise, not a keyboard.
		expect(added).toContain("OCCLUSION_SLOP");
	});

	// Bottom alignment alone is wrong for a buffer that has not filled the screen: a
	// freshly opened shell has its prompt near row 0 with blank space below, so the
	// bottom slice of an occluded grid is entirely empty - device-verified as a
	// completely blank terminal. The visible slice follows the caret instead, which
	// top-anchors a short buffer and bottom-anchors a filled one from one rule.
	test("the occluded slice follows the caret, so a short buffer is not blank", () => {
		const added = addedLines(patch);

		expect(added).toContain(
			"const bottom = Math.min(0, Math.max(-hidden, caretTop - cellHeight - hidden));"
		);
		expect(added).toContain(
			"const caretTop = raw.buffer.active.cursorY * cellHeight;"
		);
		// Nothing is ever hidden in the alternate screen - it is resized to fit.
		expect(added).toContain(
			"if (hidden <= 0 || !raw.rows || raw.buffer.active === raw.buffer.alternate) {"
		);
		// The caret moving is what changes the answer.
		expect(added).toContain(
			"this._register(xterm.raw.onCursorMove(() => this._updateOcclusionOffset()));"
		);
	});

	// The taller-than-the-pane grid relies on upstream's bottom alignment to keep the
	// cursor row above the keyboard, and must not spill over the tabs above.
	test("the occluded grid is clipped, not spilled", () => {
		const added = addedLines(patch);

		expect(added).toContain(".terminal-wrapper.composery-terminal-occluded");
		expect(added).toContain("overflow: hidden;");
		expect(added).toContain(
			"this._wrapperElement.classList.toggle('composery-terminal-occluded', stableHeight - height >= TerminalInstance.OCCLUSION_SLOP);"
		);
	});

	// The signal it reads is published by narrow.js and is deliberately NOT the
	// existing inset var, which means "overlap the viewport has not already excluded"
	// and reads 0 under interactive-widget=resizes-content.
	test("narrow.js publishes the keyboard-open signal from a viewport baseline", () => {
		const narrow = readRepoFile(
			"packages/ide/overlay/lib/vscode/out/vs/code/browser/workbench/workbench-assets/narrow.js"
		);

		expect(narrow).toContain('"--composery-touch-keyboard-open"');
		expect(narrow).toContain(
			"keyboardBaselineHeight - height >= KEYBOARD_MIN_INSET"
		);
		// A collapsing URL bar must not read as a keyboard.
		expect(narrow).toContain("const KEYBOARD_MIN_INSET = 120;");
		// Rotation resets the baseline.
		expect(narrow).toContain("if (width !== keyboardBaselineWidth) {");
	});
});
