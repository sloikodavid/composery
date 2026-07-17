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
import { tmpdir } from "node:os";
import { posix, resolve } from "node:path";
import vm from "node:vm";

import { describe, expect, test } from "vitest";

import {
	addedLines,
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
						execFileSync("patch", ["-p1", "--fuzz=0", "-i", patchFile], {
							cwd: shadow,
							encoding: "utf8",
							stdio: ["ignore", "pipe", "pipe"]
						});
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

describe("QR action", () => {
	test("is unavailable for addresses another device cannot reach", () => {
		const source = addedLines(readRepoFile(`${PATCHES_DIR}/qr-action.diff`));

		expect(source).toContain("normalizedHostname.endsWith('.localhost')");
		expect(source).toContain("normalizedHostname.startsWith('127.')");
		expect(source).toContain("normalizedHostname === '[::1]'");
		expect(source).toContain("normalizedHostname === '0.0.0.0'");
		expect(source).toContain("normalizedHostname === '[::]'");
		expect(
			source.indexOf("if (!['http:', 'https:'].includes(protocol)")
		).toBeLessThan(source.indexOf("CommandsRegistry.registerCommand"));
	});

	test("fits the QR card within narrow and short webviews", () => {
		const extension = readRepoFile(
			"packages/ide/overlay/lib/vscode/extensions/composery-qr/extension.js"
		);

		expect(extension).toContain("width: min(288px, 100%);");
		expect(extension).toContain(
			"@media (max-width: 335px), (max-height: 430px)"
		);
		expect(extension).toContain("calc(100vh - 98px)");
		expect(extension).toContain("overflow: auto;");
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

	// The touch-editor patch creates selection-handle elements that only the
	// touch overlay styles; the pair must name the same class.
	test("touch selection handles are styled by the touch overlay", () => {
		const touchEditorPatch = readRepoFile(`${PATCHES_DIR}/touch-editor.diff`);
		const touchCss = readRepoFile(`${ASSETS}/touch.css`);

		expect(touchEditorPatch).toContain("composery-touch-selection-handles");
		expect(touchCss).toContain(".composery-touch-selection-handle");
	});

	// A pan can start on editor padding as well as rendered text. It must be
	// classified before the synthetic tap path focuses the hidden editor input,
	// and keyboard-driven layout changes must preserve the current scroll.
	test("touch editor scrolling does not focus or reveal on keyboard resize", () => {
		const touchEditorPatch = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch-editor.diff`)
		);

		expect(touchEditorPatch).toContain(
			"Math.hypot(this._touchGesture.totalX, this._touchGesture.totalY) >= TOUCH_SELECTION_THRESHOLD"
		);
		expect(touchEditorPatch).toContain("this._touchGesture.panned = true");
		expect(touchEditorPatch).toContain(
			"Once scrolling is applied, release must not also focus as a tap"
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
	});

	// The editor's own selection long-press must arm before Gesture's during-hold
	// context menu fires, or a long-press would open the menu instead of
	// selecting the word under the finger.
	test("editor selection hold time stays below the gesture hold delay", () => {
		const selectionHold = Number(
			/TOUCH_SELECTION_HOLD_TIME = (\d+)/.exec(
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
	// is a pan, not a tap" magnitude: the editor's selection threshold and the
	// gesture tap-cancel slop. They live in different files, so pin them together.
	test("editor selection threshold matches the gesture tap-cancel slop", () => {
		const selectionThreshold = Number(
			/TOUCH_SELECTION_THRESHOLD = (\d+)/.exec(
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
		"%s ships the adaptive SVG favicon with the classic ICO alternate",
		(path) => {
			const raw = readRepoFile(path);
			const content = path.endsWith(".diff") ? addedLines(raw) : raw;

			expect(content).toContain("favicon.svg");
			expect(content).toContain('type="image/svg+xml"');
			// Same convention as the web app (favicon.ico + icon.svg): browsers,
			// webviews and bookmark/crawler services without SVG-favicon support
			// fall back to the ICO that brand icons.mjs already generates.
			expect(content).toContain("alternate icon");
			expect(content).toContain("favicon.ico");
			expect(content).toContain('type="image/x-icon"');
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
