import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { posix, resolve } from "node:path";
import vm from "node:vm";

import { describe, expect, test } from "vitest";

import {
	addedLines,
	applyPatch,
	evaluatePatchSnippets,
	postImageLines,
	readRepoFile,
	repoRoot
} from "./support/patchSource.ts";

const PATCHES_DIR = "packages/ide/patches";
const ASSETS =
	"packages/ide/overlay/lib/vscode/out/vs/code/browser/workbench/workbench-assets";
// The two small-screen gates are whole files we own, so they live in the overlay
// rather than in a /dev/null patch. See "overlay never shadows an upstream file".
const OVERLAY_VSCODE_SRC = "packages/ide/overlay/lib/vscode/src";
const TOUCH_GATE = `${OVERLAY_VSCODE_SRC}/vs/base/browser/touchGate.ts`;
const NARROW_GATE = `${OVERLAY_VSCODE_SRC}/vs/workbench/browser/narrowGate.ts`;
const SOFT_KEYBOARD = `${OVERLAY_VSCODE_SRC}/vs/base/browser/softKeyboard.ts`;

// Selectors are wrapped for readability in one sheet and not the other; compare
// them as the browser does, on whitespace-insensitive text.
const flat = (css: string) => css.replace(/\s+/g, " ");

// Every readable file under a repo-relative directory, as repo-relative paths.
const BINARY = /\.(png|jpe?g|gif|ico|woff2?|ttf|otf|mp4|webm|zip|gz)$/i;
function textFilesUnder(dir: string): string[] {
	return readdirSync(resolve(repoRoot, dir), { withFileTypes: true }).flatMap(
		(entry) => {
			const path = posix.join(dir, entry.name);
			if (entry.isDirectory()) return textFilesUnder(path);
			return entry.isFile() && !BINARY.test(entry.name) ? [path] : [];
		}
	);
}

// Whether a stylesheet hides an element by default and reveals it on hover - the
// upstream shape that makes a touch override necessary. `parts` identifies the
// element loosely enough to survive the extra qualifiers upstream hangs off the
// hover rule (`:hover:not(.highlighted)` and friends).
function hoverGate(css: string, parts: string[]) {
	const reveals = /display:\s*(block|flex|inline-block|inline|initial)/;
	const rules = [...flat(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
		.map((match) => ({ selector: match[1] ?? "", body: match[2] ?? "" }))
		.filter((rule) => parts.every((part) => rule.selector.includes(part)));

	return {
		hidden: rules.some(
			(rule) => /display:\s*none/.test(rule.body) && !reveals.test(rule.body)
		),
		revealedOnHover: rules.some(
			(rule) => rule.selector.includes(":hover") && reveals.test(rule.body)
		)
	};
}

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

			// After a consumed hunk the only legal continuations are another hunk,
			// a file marker, no-newline, or EOF. Anything else - a stray context
			// or blank line a hand edit left behind - makes GNU patch treat the
			// REST OF THE PATCH as garbage and drop every later hunk while
			// exiting 0. That exact failure shipped: touch-fling-catch's hunk #4
			// under-declared its body by one line and hunks 5-7 (the whole
			// inertia fix) silently never applied, in CI and in the image build.
			const next = lines[index + 1];
			const legal =
				next === undefined ||
				(next === "" && index + 2 === lines.length) || // trailing newline
				next.startsWith("@@ ") ||
				next.startsWith("diff ") ||
				next.startsWith("--- ") ||
				next.startsWith("\\");
			expect(legal, `${label} is followed by stray diff-body lines`).toBe(true);
		}

		expect(hunks).toBeGreaterThan(0);
	});

	// Count lints cannot catch a hunk GNU patch refuses at fuzz=0 (context
	// drift, parser quirks) - only real application can, and the Docker build is
	// a slow place to find out. Rehearse the exact stack the build applies:
	// code-server's own series, then ours, in order, on a shadow tree fed from
	// the pristine upstream working copy.
	//
	// Assemble one patch directory and one series first, exactly as build.sh
	// does, instead of applying the two series from where they live. Reading
	// each patch from its own directory made the rehearsal blind to the whole
	// namespace: our clipboard.diff overwrote code-server's identically named
	// patch in the build tree and appended a duplicate series entry, so the
	// image build died on "already applied" while this test stayed green. Ours
	// go under composery/ for that reason - assert the assembly keeps upstream's
	// patches intact and the series free of duplicates.
	// Timeout sized for what this does - copy a working tree and shell out to
	// patch once per file per patch - not for how long it happens to take on an
	// idle machine. It ran ~45s of a 60s budget here, so a loaded CI runner failed
	// it for being busy rather than for anything wrong with the stack.
	test(
		"the full patch stack applies with GNU patch at fuzz=0",
		{ timeout: 240_000 },
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

			const readSeries = (seriesDir: string) =>
				readFileSync(resolve(seriesDir, "series"), "utf8")
					.trim()
					.split(/\r?\n/)
					.filter((line) => line && !line.startsWith("#"));

			// build.sh step 3: upstream's patch directory, ours copied into its
			// composery/ subdirectory, their series lines then ours.
			const assembled = mkdtempSync(resolve(tmpdir(), "composery-patches-"));
			const upstreamPatches = resolve(upstream, "patches");
			const ourPatches = resolve(repoRoot, PATCHES_DIR);
			const upstreamNames = readSeries(upstreamPatches);
			const ourNames = readSeries(ourPatches);

			for (const name of upstreamNames) {
				copyFileSync(resolve(upstreamPatches, name), resolve(assembled, name));
			}
			mkdirSync(resolve(assembled, "composery"));
			for (const name of ourNames) {
				copyFileSync(
					resolve(ourPatches, name),
					resolve(assembled, "composery", name)
				);
			}
			const series = [
				...upstreamNames,
				...ourNames.map((name) => `composery/${name}`)
			];

			try {
				// The assembly above is build.sh step 3 restated in TypeScript, so it
				// is a copy that can drift - and did, in the workflow that used to
				// hold a third copy. Pin it to the script: change the namespace there
				// and this fails here rather than only in the image build.
				expect(readRepoFile("packages/ide/scripts/build.sh")).toContain(
					'cp "$PACKAGE_ROOT/patches/$p" "$BUILD/patches/composery/$p"; ' +
						'printf \'composery/%s\\n\' "$p" >> "$BUILD/patches/series"'
				);

				expect(new Set(series).size, "assembled series has duplicates").toBe(
					series.length
				);
				for (const name of upstreamNames) {
					expect(
						readFileSync(resolve(assembled, name), "utf8"),
						`assembling replaced code-server's ${name}`
					).toBe(readFileSync(resolve(upstreamPatches, name), "utf8"));
				}

				const patchedFiles = new Set<string>();
				for (const name of series) {
					const patchFile = resolve(assembled, name);
					for (const rel of filesTouched(readFileSync(patchFile, "utf8"))) {
						patchedFiles.add(rel);
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

				// Applying cleanly is not the same as compiling. Folding patches
				// merges hunks that each added the same import to a file, and the
				// duplicate only surfaced in the image build's typecheck minutes
				// later ("Duplicate identifier 'isTouch'" in layout.ts/window.ts).
				// The assembled tree is already here - reject the whole class now.
				const duplicateImports = new Map<string, string[]>();
				for (const rel of patchedFiles) {
					// Skip what the stack removes outright, not just what it edits.
					if (!/\.ts$/.test(rel) || !existsSync(resolve(shadow, rel))) continue;
					const seen = new Set<string>();
					const twice = new Set<string>();
					for (const line of readFileSync(resolve(shadow, rel), "utf8").split(
						"\n"
					)) {
						if (!/^import .* from ['"]/.test(line)) continue;
						if (seen.has(line)) twice.add(line.trim());
						seen.add(line);
					}
					if (twice.size) duplicateImports.set(rel, [...twice]);
				}
				expect(Object.fromEntries(duplicateImports)).toEqual({});

				// These security pins live in a patch because the lockfile belongs to
				// the pinned upstream submodule; Renovate cannot update a patch hunk
				// without destroying its coordinates. An upstream bump must apply the
				// stack cleanly and keep the assembled runtime on fixed versions.
				const lock = JSON.parse(
					readFileSync(resolve(shadow, "package-lock.json"), "utf8")
				) as { packages?: Record<string, { version?: string }> };
				expect(lock.packages?.["node_modules/js-yaml"]?.version).toBe("4.3.0");
				expect(lock.packages?.["node_modules/body-parser"]?.version).toBe(
					"2.3.0"
				);

				// An inline script under a hash-based CSP carries its own sha256, by
				// hand, in the same file. Edit the script and forget the hash and the
				// browser refuses to run it: the webview pre page is the whole webview
				// host, so every webview - markdown preview, notebooks, settings - comes
				// up blank, and nothing before this said a word. The assembled tree is
				// right here; recompute the hashes the way the browser does.
				const hashed = [
					"lib/vscode/src/vs/workbench/contrib/webview/browser/pre/index.html",
					"lib/vscode/src/vs/workbench/services/extensions/worker/webWorkerExtensionHostIframe.html"
				];
				for (const rel of hashed) {
					const html = readFileSync(resolve(shadow, rel), "utf8");
					const csp = /content="([^"]*script-src[^"]*)"/s.exec(html)?.[1];
					expect(csp, `${rel} declares no script-src`).toEqual(
						expect.any(String)
					);

					const scripts = [
						...html.matchAll(
							/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi
						)
					];
					expect(scripts.length, `${rel} has no inline script`).toBeGreaterThan(
						0
					);
					for (const [, body] of scripts) {
						const digest = createHash("sha256")
							// Windows checkouts are CRLF; the served file is LF, and so is
							// what the browser hashes.
							.update(Buffer.from((body ?? "").replaceAll("\r\n", "\n")))
							.digest("base64");
						expect(
							csp,
							`${rel}: inline script is not 'sha256-${digest}'`
						).toContain(`sha256-${digest}`);
					}
				}
			} finally {
				rmSync(shadow, { recursive: true, force: true });
				rmSync(assembled, { recursive: true, force: true });
			}
		}
	);
});

describe("local media preview", () => {
	const patch = () => readRepoFile(`${PATCHES_DIR}/local-media-preview.diff`);

	test("keeps uploaded media binary and outside the workspace", () => {
		const source = addedLines(patch());

		expect(source).toContain("if (getMediaMime(name))");
		expect(source).toContain("scheme: Schemas.tmp");
		expect(source).toContain("await fileService.writeFile(resource, contents)");
		// Media returns a resource and nothing else: contents is what an untitled
		// editor decodes, and text still takes that branch untouched.
		expect(source).toContain("result.complete({ resource });");
		expect(patch()).toContain(
			" \t\t\t\t\tresource: URI.from({ scheme: Schemas.untitled, path: name }),"
		);
	});

	// Both takers of a local file - the unsupported-browser "Open Files..."
	// fallback and a drop onto the workbench - hand extractFileListData's result
	// straight to openEditors. Fixing either call site leaves the other one
	// decoding the same bytes, so the fix has to stay in the helper they share.
	test("fixes the shared helper, not one of its two call sites", () => {
		const touched = patch()
			.split("\n")
			.filter((line) => line.startsWith("--- a/"))
			.map((line) => line.slice("--- a/".length));

		expect(touched).toEqual(["lib/vscode/src/vs/platform/dnd/browser/dnd.ts"]);
	});
});

// The workbench half of the QR is a patch, the rendering half is a shipped
// extension. Top-level function declarations in a vm context land on the context
// object, so the extension's internals are reachable without test-only exports.
function loadQrExtension(
	networkInterfaces: () => Record<
		string,
		Array<{
			address: string;
			family: string;
			internal: boolean;
		} | null>
	> = () => ({}),
	vscodeApi: unknown = { commands: {}, window: {} }
): {
	activate: (context: {
		subscriptions: { push(disposable: unknown): void };
	}) => void;
	isReachableFromAnotherDevice: (url: URL) => boolean;
	networkAddresses: (url: URL) => string[];
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
			if (name === "vscode") return vscodeApi;
			if (name === "node:os") return { networkInterfaces };
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

	expect(context.activate).toBeTypeOf("function");
	expect(context.isReachableFromAnotherDevice).toBeTypeOf("function");
	expect(context.networkAddresses).toBeTypeOf("function");
	expect(context.render).toBeTypeOf("function");
	return {
		activate: context.activate as (context: {
			subscriptions: { push(disposable: unknown): void };
		}) => void,
		isReachableFromAnotherDevice: context.isReachableFromAnotherDevice as (
			url: URL
		) => boolean,
		networkAddresses: context.networkAddresses as (url: URL) => string[],
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

	test("offers useful LAN links before container bridge addresses", () => {
		const { networkAddresses } = loadQrExtension(() => ({
			docker: [{ address: "172.18.0.2", family: "IPv4", internal: false }],
			wifi: [
				{ address: "192.168.1.192", family: "IPv4", internal: false },
				{ address: "fe80::1", family: "IPv6", internal: false }
			],
			loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }]
		}));

		expect(
			networkAddresses(
				new URL("http://localhost:8080/code/?folder=/home/user#readme")
			)
		).toEqual([
			"http://192.168.1.192:8080/code/?folder=/home/user#readme",
			"http://172.18.0.2:8080/code/?folder=/home/user#readme"
		]);
	});

	test("opens a selected network address from an explanatory toast", async () => {
		const lanUrl = "http://192.168.1.192:8080/";
		let command: ((value: string) => Promise<void>) | undefined;
		let warning: unknown[] | undefined;
		let opened: unknown;
		const { activate } = loadQrExtension(
			() => ({
				wifi: [{ address: "192.168.1.192", family: "IPv4", internal: false }]
			}),
			{
				commands: {
					registerCommand(
						_id: string,
						handler: (value: string) => Promise<void>
					) {
						command = handler;
						return { dispose() {} };
					}
				},
				env: {
					openExternal(uri: unknown) {
						opened = uri;
						return Promise.resolve(true);
					}
				},
				Uri: { parse: (value: string) => value },
				window: {
					showWarningMessage(...items: unknown[]) {
						warning = items;
						return Promise.resolve(lanUrl);
					}
				}
			}
		);

		activate({ subscriptions: { push() {} } });
		if (!command) throw new Error("QR command was not registered");
		await command("http://localhost:8080/");

		expect(warning).toEqual([
			"This address only works on this device. Try one below. Composery found these addresses on this computer, but cannot tell which one your other device can use.",
			lanUrl
		]);
		expect(opened).toBe(lanUrl);
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
		// Nothing keyed on the frame's own viewport or safe area: this page is
		// webview content, where Chromium honours neither (see the mobile viewport
		// contract). Both used to be here, and both only ever hit their fallback.
		expect(extension).not.toContain('name="viewport"');
		expect(extension).not.toContain("env(safe-area-inset");
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
		// ImeEnterFallback is a whole file we own, so it lives in the overlay rather
		// than in a /dev/null hunk in touch.diff.
		const source = readRepoFile(
			`${OVERLAY_VSCODE_SRC}/vs/base/browser/imeEnter.ts`
		);

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
		// The line-break insertion is cancelled when a consumer handled the replay - or
		// unconditionally when the keybar armed a modifier, since the synthetic keydown
		// then replaces the commit outright (see the Shift+Enter test).
		expect(source).toContain("const handled = !target.dispatchEvent(keydown);");
		// Installed for the main window and every future auxiliary window.
		expect(source).toContain("Event.runAndSubscribe(onDidRegisterWindow");
		// The construction site stays an upstream edit, so it stays in the patch.
		expect(addedLines(readRepoFile(`${PATCHES_DIR}/touch.diff`))).toContain(
			"this._register(new ImeEnterFallback());"
		);
	});

	test("asks soft keyboards for a newline key on single-line inputs", () => {
		const patch = readRepoFile(`${PATCHES_DIR}/touch.diff`);

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
		const source = addedLines(readRepoFile(`${PATCHES_DIR}/touch.diff`));

		// The OK button feeds the same accept emitter Enter does; showing it on
		// touch guarantees submission even when the IME emits no event at all.
		expect(source).toContain("ok: isTouch(dom.getWindow(this.ui.container)),");
	});
});

describe("touch link activation", () => {
	test("terminal taps hit-test detected links and skip word links", () => {
		const source = addedLines(readRepoFile(`${PATCHES_DIR}/touch.diff`));

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
		const source = addedLines(readRepoFile(`${PATCHES_DIR}/touch.diff`));

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
		const source = addedLines(readRepoFile(`${PATCHES_DIR}/touch.diff`));

		expect(source).toContain("if (isTouch(DOM.getWindow(outElement))) {");
		expect(source).toContain("Gesture.addTarget(outElement)");
		expect(source).toContain("TouchEventType.Tap");
		// Tap resolves the anchor from the touched node, not the dispatch target.
		expect(source).toContain("DOM.isHTMLElement(e.initialTarget)");
	});
});

describe("touch inline actions", () => {
	test("lists, tables and trees stand down on taps consumed by inline controls", () => {
		const source = addedLines(readRepoFile(`${PATCHES_DIR}/touch.diff`));

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

	// Forcing an action bar visible is only right while upstream is still hiding it
	// behind a hover a finger cannot produce. Check the pairing against upstream
	// itself: if a bump stops hiding one, the !important below is no longer a fix
	// but a forced state we are imposing, and if the class is renamed the rule is
	// dead while looking exactly as alive as the rest.
	test("every forced action bar is one upstream still hides behind hover", () => {
		const touchCss = flat(readRepoFile(`${ASSETS}/touch.css`));

		for (const { css, parts, forced } of [
			{
				css: "src/vs/workbench/browser/parts/notifications/media/notificationsList.css",
				parts: [".notification-list-item-toolbar-container"],
				forced: ".notification-list-item-toolbar-container"
			},
			{
				css: "src/vs/workbench/contrib/search/browser/media/searchview.css",
				parts: [".search-view", ".monaco-list-row", ".monaco-action-bar"],
				forced: ".search-view .monaco-list .monaco-list-row .monaco-action-bar"
			},
			{
				css: "src/vs/workbench/contrib/preferences/browser/media/settingsWidgets.css",
				parts: [".setting-list-row", ".monaco-action-bar"],
				forced: ".setting-list-row .monaco-action-bar"
			}
		]) {
			const upstream = readRepoFile(`packages/ide/upstream/lib/vscode/${css}`);
			expect({
				forced,
				coveredOnTouch: touchCss.includes(forced),
				...hoverGate(upstream, parts)
			}).toEqual({
				forced,
				coveredOnTouch: true,
				hidden: true,
				revealedOnHover: true
			});
		}
	});

	// The IDE tree is built apart from the workspace, so it cannot import `shared` and
	// every Composery address it ships is a copy: the title-bar logo, the auth page's
	// brand link, product.json's documentation and newsletter URLs, the repository
	// coordinates. Copies drift in silence - shared says of REPO that "a fork repoints
	// these once and every derived URL follows", which is only true of the copies
	// something checks. This is that check.
	test("every Composery address in the IDE is the one shared defines", () => {
		const shared = readRepoFile("packages/shared/index.ts");
		const websiteOrigin = /WEBSITE_ORIGIN = "([^"]+)"/.exec(shared)?.[1];
		const repoOwner = /owner: "([^"]+)"/.exec(shared)?.[1];
		const repoName = /name: "([^"]+)"/.exec(shared)?.[1];
		expect({ websiteOrigin, repoOwner, repoName }).toEqual({
			websiteOrigin: expect.any(String) as string,
			repoOwner: expect.any(String) as string,
			repoName: expect.any(String) as string
		});

		const wrong: string[] = [];
		for (const file of textFilesUnder("packages/ide/patches").concat(
			textFilesUnder("packages/ide/overlay")
		)) {
			for (const match of readRepoFile(file).matchAll(
				/https?:\/\/[^"'\s)`]+/g
			)) {
				let url: URL;
				try {
					url = new URL(match[0]);
				} catch {
					continue; // a template literal, not an address
				}

				if (
					url.hostname.includes("composery") &&
					url.origin !== websiteOrigin
				) {
					wrong.push(`${file}: ${match[0]}`);
				}
				// Only addresses that name this project. Links to code-server and VS Code
				// are upstream provenance and belong to their owners.
				const repo = url.pathname.split("/")[2]?.replace(/\.git$/, "");
				if (
					url.hostname === "github.com" &&
					repo?.toLowerCase().includes("composery") &&
					!url.pathname.startsWith(`/${repoOwner}/${repoName}`)
				) {
					wrong.push(`${file}: ${match[0]}`);
				}
			}
		}

		expect(wrong).toEqual([]);
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
// shell.js keyboard-inset behavior, executed in a browser-shaped VM.
// ---------------------------------------------------------------------------

function runNarrowViewportVars({
	innerHeight = 800,
	visualViewport
}: {
	innerHeight?: number;
	visualViewport?: { height: number; offsetTop: number; width?: number };
}): {
	properties: Map<string, string>;
	setVisualViewportHeight(height: number): void;
	fireVisualViewportResize(): void;
} {
	const shellJs = readRepoFile(`${ASSETS}/shell.js`);
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
	const context = vm.createContext({
		HTMLElement: class HTMLElement {},
		KeyboardEvent: class KeyboardEvent {
			constructor() {}
		},
		MutationObserver: class MutationObserver {
			observe() {}
		},
		document: {
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
		// No virtualKeyboard: the shipped page never enables overlaysContent, so
		// the API reports a structural zero and shell.js does not read it. A stub
		// here would only prove a branch that cannot run in the product.
		navigator: {},
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
	vm.runInContext(shellJs, context);

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

// ---------------------------------------------------------------------------
// softKeyboard.ts: the single answer three surfaces ask.
// ---------------------------------------------------------------------------

interface FakeViewport {
	height: number;
	offsetTop: number;
	scale: number;
}

function fakeWindow(
	innerHeight: number,
	viewport: FakeViewport | undefined,
	vars: Record<string, string> = {}
): Window {
	return {
		innerHeight,
		visualViewport: viewport,
		document: { documentElement: {} },
		getComputedStyle: () => ({
			getPropertyValue: (name: string) => vars[name] ?? ""
		})
	} as unknown as Window;
}

// The overlay file has no imports, so it evaluates as-is once `export` is stripped -
// the shipped code, not a paraphrase of it.
const { softKeyboard } = evaluatePatchSnippets<{
	softKeyboard: (targetWindow: Window) => { open: boolean; overlap: number };
}>([readRepoFile(SOFT_KEYBOARD).replace(/^export /gm, "")], ["softKeyboard"]);

describe("soft keyboard", () => {
	// Shrinks the visual viewport only (iOS Safari): the difference IS the keyboard,
	// and the height we lay out to already excludes it, so nothing more to subtract.
	test("sees a keyboard that shrinks only the visual viewport", () => {
		expect(
			softKeyboard(fakeWindow(800, { height: 520, offsetTop: 0, scale: 1 }))
		).toEqual({ open: true, overlap: 0 });
	});

	// Shrinks both viewports in lockstep (our interactive-widget=resizes-content
	// viewport on Chromium): every measurement here reads zero, and only shell.js's
	// published verdict sees it. Measuring instead of reading it is what made the
	// editor blur and refocus its hidden input on every single tap.
	test("sees a keyboard that shrinks both viewports only through the verdict", () => {
		const geometry = { height: 520, offsetTop: 0, scale: 1 };

		expect(softKeyboard(fakeWindow(520, geometry))).toEqual({
			open: false,
			overlap: 0
		});
		expect(
			softKeyboard(
				fakeWindow(520, geometry, { "--composery-touch-keyboard-open": "1" })
			)
		).toEqual({ open: true, overlap: 0 });
	});

	// Shrinks neither (Composery Mobile's edge-to-edge WKWebView): the host reports
	// the covered height and it is the only thing left to subtract.
	test("subtracts a keyboard only the native host can see", () => {
		expect(
			softKeyboard(
				fakeWindow(
					800,
					{ height: 800, offsetTop: 0, scale: 1 },
					{
						"--composery-touch-keyboard-inset": "180px"
					}
				)
			)
		).toEqual({ open: true, overlap: 180 });
	});

	// A viewport that already excluded the keyboard needs nothing more: subtracting
	// a reported inset on top of it would cut the workbench twice.
	test("never subtracts a measured and a reported keyboard together", () => {
		expect(
			softKeyboard(
				fakeWindow(
					800,
					{ height: 520, offsetTop: 0, scale: 1 },
					{
						"--composery-touch-keyboard-inset": "180px"
					}
				)
			)
		).toEqual({ open: true, overlap: 0 });
	});

	test("reads a structural zero where there is no keyboard", () => {
		// A viewport pushed down rather than shrunk (iOS scrolls the visual viewport
		// to keep the focused field visible) is not keyboard overlap.
		expect(
			softKeyboard(fakeWindow(800, { height: 800, offsetTop: 120, scale: 1 }))
		).toEqual({ open: false, overlap: 0 });
		// No visualViewport at all - the whole feature is inert, never NaN.
		expect(softKeyboard(fakeWindow(800, undefined))).toEqual({
			open: false,
			overlap: 0
		});
	});

	// iOS honours pinch even under user-scalable=no, and a zoomed visual viewport is
	// short for reasons that have nothing to do with a keyboard.
	test("does not read pinch zoom as a keyboard", () => {
		expect(
			softKeyboard(fakeWindow(800, { height: 400, offsetTop: 0, scale: 2 }))
		).toEqual({ open: false, overlap: 0 });
	});

	// One home, pinned by readership: the copy that drifted was a second measurement
	// in the editor's tap handler, which our own viewport meta makes permanently 0.
	test("is the only place that reads the keyboard properties", () => {
		const users = [
			...textFilesUnder(PATCHES_DIR),
			...textFilesUnder(OVERLAY_VSCODE_SRC),
			...textFilesUnder(ASSETS)
		].filter((file) =>
			/--composery-touch-keyboard-(open|inset)/.test(readRepoFile(file))
		);

		expect(users.sort()).toEqual(
			[
				`${ASSETS}/narrow.css`, // declares the host channel's default
				`${ASSETS}/shell.js`, // publishes the open verdict
				SOFT_KEYBOARD // the only reader
			].sort()
		);
	});

	// Both consumers go through it - the workbench fit and the editor's tap.
	test("answers the workbench fit and the editor tap alike", () => {
		const source = addedLines(readRepoFile(`${PATCHES_DIR}/touch.diff`));

		expect(source).toContain("const keyboard = softKeyboard(mainWindow);");
		expect(source).toContain(
			"Math.round(viewport.height) - keyboard.overlap - safeAreaBottom"
		);
		expect(source).toContain(
			"if (!softKeyboard(dom.getWindow(this.viewHelper.viewDomNode)).open"
		);
	});
});

describe("narrow overlay", () => {
	// The one shape no geometry in the page can see: with
	// interactive-widget=resizes-content the keyboard shrinks the layout viewport in
	// lockstep with the visual one, so innerHeight - visualViewport.height is a
	// structural zero. shell.js publishes the verdict from the tallest viewport seen
	// at this width instead, and softKeyboard.ts is its only reader.
	test("publishes the keyboard-open verdict from a viewport-height baseline", () => {
		const run = runNarrowViewportVars({
			innerHeight: 800,
			visualViewport: { height: 800, offsetTop: 0 }
		});
		expect(run.properties.get("--composery-touch-keyboard-open")).toBe("0");

		run.setVisualViewportHeight(520);
		run.fireVisualViewportResize();
		expect(run.properties.get("--composery-touch-keyboard-open")).toBe("1");

		run.setVisualViewportHeight(800);
		run.fireVisualViewportResize();
		expect(run.properties.get("--composery-touch-keyboard-open")).toBe("0");

		// Browser chrome collapsing is not a keyboard: under the 120px floor the
		// verdict must stay negative.
		run.setVisualViewportHeight(720);
		run.fireVisualViewportResize();
		expect(run.properties.get("--composery-touch-keyboard-open")).toBe("0");
	});

	// The workbench layout listener (touch.diff) registers after shell.js on the same
	// visualViewport and reads --composery-touch-keyboard-open within the same resize
	// delivery. The vars must update synchronously in shell.js's geometry listeners:
	// an animation-frame update hands the layout a stale verdict and wedges the
	// workbench at the keyboard-open height after the keyboard closes. The harness
	// stubs requestAnimationFrame as a no-op, so only the sync path can pass the test
	// above - and --composery-viewport-height, which narrow.css sizes every overlay
	// from, rides the same pass.
	test("viewport height updates synchronously within the resize delivery", () => {
		const run = runNarrowViewportVars({
			innerHeight: 800,
			visualViewport: { height: 800, offsetTop: 0 }
		});
		expect(run.properties.get("--composery-viewport-height")).toBe("800px");

		run.setVisualViewportHeight(520);
		run.fireVisualViewportResize();
		expect(run.properties.get("--composery-viewport-height")).toBe("520px");
	});

	// --composery-touch-keyboard-inset carries the one measurement the page cannot
	// make: the height a keyboard covers in a WebView that resizes neither viewport.
	// Its only writer is the native host. shell.js runs on every workbench mutation,
	// so a value of its own here overwrote the host's within a frame and left
	// iOS-in-app with no keyboard signal at all.
	test("leaves the native keyboard inset to the host that measures it", () => {
		const shellJs = readRepoFile(`${ASSETS}/shell.js`);
		const run = runNarrowViewportVars({
			innerHeight: 800,
			visualViewport: { height: 520, offsetTop: 0 }
		});

		expect(shellJs).not.toMatch(
			/setProperty\(\s*["']--composery-touch-keyboard-inset["']/
		);
		expect(run.properties.has("--composery-touch-keyboard-inset")).toBe(false);
		// Declared with a 0px default, so a plain browser reads a true zero.
		expect(readRepoFile(`${ASSETS}/narrow.css`)).toContain(
			"--composery-touch-keyboard-inset: 0px;"
		);
		// And the host still writes it.
		expect(
			readRepoFile("packages/mobile/src/components/instance-view.tsx")
		).toContain('"--composery-touch-keyboard-inset"');
	});

	// With interactive-widget=resizes-content the keyboard also resizes the layout
	// viewport, and its final at-rest geometry can arrive as a window resize after
	// the last visualViewport event of the animation. Listening only to
	// visualViewport leaves the workbench wedged at the keyboard-open height
	// (verified live on Android Chrome); both viewports must drive layout().
	test("keyboard layout listens to the layout viewport as well", () => {
		const viewportPatch = addedLines(readRepoFile(`${PATCHES_DIR}/touch.diff`));

		expect(viewportPatch).toContain("if (viewport !== mainWindow) {");
		expect(viewportPatch).toContain(
			"this._register(addDisposableListener(mainWindow, EventType.RESIZE, () => {"
		);
	});

	// Two independent small-screen gates: touch (hover/pointer) and narrow
	// (viewport width). Keyboard geometry belongs to neither - it is softKeyboard.ts;
	// the touch gate must never grow viewport knowledge.
	test("keeps the touch gate free of keyboard-inset logic", () => {
		const touchGatePatch = readRepoFile(TOUCH_GATE);

		expect(touchGatePatch).toContain("TOUCH_QUERY");
		expect(touchGatePatch).not.toContain("keyboardInset");
		expect(touchGatePatch).not.toContain("KeyboardInset");
		expect(touchGatePatch).not.toContain("visualViewport");
	});

	// The touch-editor patch creates the selection drag handles (caret + both range
	// ends) that only the touch overlay styles; the pair must name the same classes.
	test("touch selection handles are styled by the touch overlay", () => {
		const touchEditorPatch = readRepoFile(`${PATCHES_DIR}/touch.diff`);
		const touchCss = readRepoFile(`${ASSETS}/touch.css`);

		expect(touchEditorPatch).toContain("composery-touch-caret-handle");
		expect(touchCss).toContain(".composery-touch-caret-handle");
		expect(touchEditorPatch).toContain("composery-touch-range-handle-");
		expect(touchCss).toContain(".composery-touch-range-handle-start");
		expect(touchCss).toContain(".composery-touch-range-handle-end");
	});

	// Touch selection is editor-driven: the browser's selection UI aims at the
	// focused element, and the editor's focused element is a hidden one-pixel
	// input - never the rendered lines the finger is on (device-verified: with the
	// editor focused, Chrome's long-press and handle drags operate on the hidden
	// input at garbage geometry). So a long-press word-selects through the model
	// and custom handles adjust it; no browser selection may exist in the lines.
	test("editor touch selection is model-driven, not browser-native", () => {
		const touchEditorPatch = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch.diff`)
		);
		const touchCss = readRepoFile(`${ASSETS}/touch.css`);

		// Long-press on text selects the word (a double-click dispatch); the hold
		// inside an existing selection opens the IDE menu instead.
		expect(touchEditorPatch).toContain(
			"this._dispatchMouseTarget(target, /*inSelectionMode*/false, /*mouseDownCount*/2)"
		);
		expect(touchEditorPatch).toContain("startedInSelection");

		// Range handles keep the far end anchored in model coordinates, so an edge
		// auto-scroll can extend past the rendered lines.
		expect(touchEditorPatch).toContain("_setSelectionFromClientPoint");
		expect(touchEditorPatch).toContain(
			"Selection.fromPositions(drag.anchor, modelPosition)"
		);

		// The native-selection experiment is gone: no selectable lines, no browser
		// selection sync, no transparent ::selection to hide one.
		expect(touchEditorPatch).not.toContain("selectionchange");
		expect(touchEditorPatch).not.toContain("nativeSelectionZone");
		expect(touchCss).not.toContain("user-select: text !important");
		expect(touchCss).not.toContain("::selection");
	});

	// A pan can start on editor padding as well as rendered text. It must be
	// classified before the synthetic tap path focuses the hidden editor input,
	// and keyboard-driven layout changes must preserve the current scroll.
	test("touch editor scrolling does not focus or reveal on keyboard resize", () => {
		const touchEditorPatch = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch.diff`)
		);

		expect(touchEditorPatch).toContain(
			"Math.hypot(this._touchGesture.totalX, this._touchGesture.totalY) >= PAN_THRESHOLD"
		);
		expect(touchEditorPatch).toContain("this._touchGesture.panned = true");
		expect(touchEditorPatch).toContain(
			"if (this._touchGesture?.panned || this._touchGesture?.menuOpened)"
		);
		// A tap re-opens a dismissed keyboard by cycling focus, and must not cycle it
		// while the keyboard is up. That verdict comes from softKeyboard - the editor
		// measured the viewport delta itself, which our interactive-widget viewport
		// makes permanently 0, so it blurred and refocused on every tap.
		expect(touchEditorPatch).toContain(
			"if (!softKeyboard(dom.getWindow(this.viewHelper.viewDomNode)).open"
		);
		expect(touchEditorPatch).not.toMatch(
			/targetWindow\.innerHeight - viewport\.height/
		);
		expect(touchEditorPatch).not.toContain("revealAllCursors");
		// One definition of "touch" in the editor: the per-interaction pointer
		// type. A second device-level gate here was redundant with it.
		expect(touchEditorPatch).not.toContain("isTouchDevice");
	});

	// A flick released from the editor's caret handle must not fling the view.
	// Gesture's normal dispatch honours the ignore list, but inertia dispatches
	// directly - the fix lives there, so the editor needs no suppression-window
	// state of its own (which was racy: a timed window around drag end).
	test("inertia honours the ignore list instead of an editor timer", () => {
		const flingPatch = addedLines(readRepoFile(`${PATCHES_DIR}/touch.diff`));
		const touchEditorPatch = readRepoFile(`${PATCHES_DIR}/touch.diff`);

		expect(flingPatch).toContain(
			"const ignored = !!owner && [...this.ignoreTargets].some(t => t.contains(owner));"
		);
		expect(touchEditorPatch).not.toContain("_suppressTouchInertiaUntil");
	});

	// Upstream picks PointerEventHandler only for phone UAs (isIOS, or isAndroid
	// with the "Mobi" token). Android tablets and touch laptops then fall back to
	// the legacy TouchHandler, which has none of the touch selection, handle and
	// context-menu support - so the gate must be the canonical touch gate.
	test("PointerEventHandler is gated on the touch gate, not the phone UA", () => {
		const touchEditorPatch = readRepoFile(`${PATCHES_DIR}/touch.diff`);

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
			readRepoFile(`${PATCHES_DIR}/touch.diff`)
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
		const layoutPatch = addedLines(readRepoFile(`${PATCHES_DIR}/narrow.diff`));

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

	// shell.js signals overlay-back state to the native app; the mobile WebView
	// listens for the same protocol strings (in the InstanceView the WebView lives
	// in - the route itself is only a focus marker).
	test("overlay-back protocol matches between shell.js and the mobile app", () => {
		const shellJs = readRepoFile(`${ASSETS}/shell.js`);
		const instanceView = readRepoFile(
			"packages/mobile/src/components/instance-view.tsx"
		);

		expect(shellJs).toContain("composery:overlay-back:");
		expect(instanceView).toContain("composery:overlay-back:on");
		expect(instanceView).toContain("composery:overlay-back:off");
	});

	// A back press is handed to the page, which closes its top layer or answers
	// "composery:back" so the app leaves. Same entry point on both sides, or every
	// press in the IDE goes straight back to the instances list.
	test("the native back call matches between shell.js and the mobile app", () => {
		const shellJs = readRepoFile(`${ASSETS}/shell.js`);
		const webScripts = readRepoFile("packages/mobile/src/web/back-button.ts");

		expect(shellJs).toContain("window.__composeryNativeBack = function");
		expect(shellJs).toContain('postNative("composery:back")');
		expect(webScripts).toContain("window.__composeryNativeBack()");
	});

	// The WebView's session history holds login redirects and, in a browser, the
	// guard's own sentinels - never a screen the user asked to return to. Walking
	// it was what made back land on the login page or nowhere at all.
	test("the app never walks the WebView's history", () => {
		const instanceView = readRepoFile(
			"packages/mobile/src/components/instance-view.tsx"
		);

		expect(instanceView).not.toContain(".goBack()");
		expect(instanceView).not.toContain("canGoBack");
		expect(instanceView).not.toContain("onNavigationStateChange");
	});

	// Rotation can make a phone wider than the narrow layout breakpoint while
	// Android hardware Back still needs to dismiss dialogs and menus in the IDE.
	test("overlay back guards survive wide coarse-pointer orientation", () => {
		const shellJs = readRepoFile(`${ASSETS}/shell.js`);

		expect(shellJs).toContain('window.matchMedia("(pointer: coarse)")');
		expect(shellJs).toContain("if (!narrow.matches && !coarsePointer.matches)");
	});

	// A back gesture with a narrow-fullscreen part open must close the part, not
	// leave the page: shell.js dispatches the close event and the layout patch
	// listens for it - same literal on both sides or back exits the IDE.
	test("narrow close-part event matches between shell.js and the layout patch", () => {
		const shellJs = readRepoFile(`${ASSETS}/shell.js`);
		const layoutPatch = readRepoFile(`${PATCHES_DIR}/narrow.diff`);

		expect(shellJs).toContain('"composery-narrow-close-part"');
		expect(addedLines(layoutPatch)).toContain("'composery-narrow-close-part'");
	});

	test("narrow rotation preserves the part selected on mobile", () => {
		const layoutPatch = addedLines(readRepoFile(`${PATCHES_DIR}/narrow.diff`));

		expect(layoutPatch).toContain("if (this.inNarrowPartTransition)");
		expect(layoutPatch).toContain("desktopPartVisibility.add(this.narrowPart)");
	});

	test("mobile extension features keep wide table columns reachable", () => {
		const extensionsPatch = addedLines(
			readRepoFile(`${PATCHES_DIR}/narrow.diff`)
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
		// narrow.diff (its allocated width is what triggers
		// overflow mode), so narrow.css must not width-force it.
		expect(narrowCss).toMatch(
			/> \.titlebar-left \{[\s\S]*?min-width: 77px !important;/
		);
		expect(narrowCss).not.toContain(".menubar.overflow-menu-only");
	});

	test("short touch layouts keep the footer's row for content", () => {
		const compactFooterPatch = addedLines(
			readRepoFile(`${PATCHES_DIR}/touch.diff`)
		);
		const narrowCss = readRepoFile(`${ASSETS}/narrow.css`);

		expect(compactFooterPatch).toContain(
			"isTouch(getWindow(this.contentArea))"
		);
		expect(compactFooterPatch).toContain("composery-compact-footer");
		expect(narrowCss).toContain(".part.composery-compact-footer > .footer");
	});

	// The keybar costs workbench height, so the properties that keep it from
	// "ruining the experience by taking up space" are load-bearing: it is reserved
	// out of the grid (or it would overlap content), and driven by the keyboard signal
	// from layout(). Terminal focus adds height with no layout event of its own, so
	// layout() must also relayout when the bar's reserved height changes.
	test("keybar height is reserved out of the grid, keyboard-driven", () => {
		const keybarPatch = addedLines(readRepoFile(`${PATCHES_DIR}/touch.diff`));

		expect(keybarPatch).toContain(
			"this.workbenchGrid.layout(this._mainContainerDimension.width, " +
				"this._mainContainerDimension.height - (this.keybar?.height ?? 0))"
		);
		expect(keybarPatch).toContain(
			"this.keybar?.setViewport(keyboard.open, visibleHeight)"
		);
		// The verdict must come from softKeyboard, never from a viewport delta measured
		// here: our viewport meta is interactive-widget=resizes-content, so
		// innerHeight - visualViewport.height is structurally 0 and a keyboard test built
		// from it alone can never be true - the keybar shipped dead in mobile web on
		// exactly that. Device-verified 2026-07-22.
		expect(keybarPatch).toContain("const keyboard = softKeyboard(mainWindow);");
		expect(keybarPatch).not.toMatch(
			/mainWindow\.innerHeight - viewport\.height/
		);
		// Terminal focus toggles the reserved height between layout passes; without this
		// relayout the grid never gives the rows back when focus leaves the terminal.
		expect(keybarPatch).toContain(
			"this.keybar.onDidChangeHeight(() => this.layout())"
		);
	});

	// Its visibility rule is the whole design: `height` is gated on `visible`, not merely
	// on the bar existing - and `visible` is the keyboard OR a focused terminal, so the bar
	// docks for terminal keys with no keyboard up yet never becomes permanent elsewhere.
	test("keybar height is gated on visibility, keyboard or focused terminal", () => {
		const keybar = readRepoFile(
			`${OVERLAY_VSCODE_SRC}/vs/workbench/browser/keybar.ts`
		);

		expect(keybar).toMatch(
			/get height\(\): number \{\s*if \(!this\.visible\) \{\s*return 0;/
		);
		expect(keybar).toMatch(
			/get visible\(\): boolean \{\s*return !!this\.bar && \(this\.keyboardVisible \|\| this\.terminalFocused\);/
		);
		// terminalFocused tracks focus into any .xterm - the one surface whose keys earn
		// the bar with no keyboard up.
		expect(keybar).toContain("active.closest('.xterm')");
	});

	// A short viewport drops to one row, and that row must be reachable: compact
	// carries no Fn key, so inheriting the Fn layer would strand the user in F1-F12
	// with no way back.
	test("keybar collapses to one row and never strands the Fn layer", () => {
		const keybar = readRepoFile(
			`${OVERLAY_VSCODE_SRC}/vs/workbench/browser/keybar.ts`
		);

		expect(keybar).toContain("const compact = visibleHeight < COMPACT_BELOW;");
		expect(keybar).toMatch(
			/if \(!visible \|\| this\.compact\) \{\s*this\.fnLayer = false;/
		);
		expect(keybar).toMatch(
			/const rows = this\.compact \? COMPACT_ROWS : this\.fnLayer \? FN_ROWS : BASE_ROWS;/
		);
		// COMPACT_ROWS is one row, and holds no key that toggles a layer.
		const compactRows = keybar.match(/const COMPACT_ROWS[\s\S]*?\n\];/)?.[0];
		expect(compactRows).toBeDefined();
		expect(compactRows).not.toContain("FN");
		// Exactly one inner array between the `= [` and its close.
		expect(compactRows).toMatch(/= \[\s*\[[^[\]]*\]\s*\];/);
	});

	// render() reruns on every keyboard show/hide, compact switch and Fn toggle. Per-key
	// listeners on the object's own store would pin a fresh set of detached nodes each
	// pass and release none of them, so they belong to a store that render() clears.
	test("keybar releases per-key listeners on every re-render", () => {
		const keybar = readRepoFile(
			`${OVERLAY_VSCODE_SRC}/vs/workbench/browser/keybar.ts`
		);

		const addKey = keybar.match(/private addKey\([\s\S]*?\n\t\}/)?.[0];
		expect(addKey).toBeDefined();
		// Everything addKey attaches is scoped to the clearable store.
		expect(addKey).not.toContain("this._register(");
		expect(addKey?.match(/this\.keyDisposables\.add\(/g)?.length).toBe(3);
		// ...and render() actually clears it before rebuilding.
		expect(keybar).toMatch(
			/private render\(\): void \{[\s\S]*?this\.keyDisposables\.clear\(\);[\s\S]*?dom\.clearNode\(this\.bar\);/
		);
	});

	// Shift+Enter is the chord a phone can neither send nor be taught to send: Enter
	// reaches the page as a data-less insertLineBreak, so it never passes through the
	// keybar at all. ImeEnterFallback is the only code that sees it, which is why the
	// sticky modifiers are shared state rather than the keybar's own.
	test("soft-keyboard Enter carries the keybar's sticky modifiers", () => {
		const ime = readRepoFile(
			`${OVERLAY_VSCODE_SRC}/vs/base/browser/imeEnter.ts`
		);

		// The replayed Enter must carry the flags, not be a bare Enter.
		expect(ime).toMatch(/shiftKey: stickyModifiers\.held\('shift'\)/);
		// An armed modifier lifts the xterm exemption - xterm's own input path is exactly
		// what will not apply a sticky Shift.
		expect(ime).toMatch(
			/if \(!armed && target\.closest\('\.xterm'\)\) \{\s*return;/
		);
		// ...and there the commit is cancelled outright, or the terminal sees two newlines.
		expect(ime).toMatch(
			/if \(handled \|\| armed\) \{\s*e\.preventDefault\(\);/
		);
		// A used modifier must be spent, or it leaks onto the next keystroke.
		expect(ime).toMatch(/if \(armed\) \{\s*stickyModifiers\.consume\(\);/);
	});

	// Both writers must agree on one store; a private copy in either is the bug this
	// module exists to prevent.
	test("keybar and Enter fallback share one sticky modifier store", () => {
		const keybar = readRepoFile(
			`${OVERLAY_VSCODE_SRC}/vs/workbench/browser/keybar.ts`
		);
		const ime = readRepoFile(
			`${OVERLAY_VSCODE_SRC}/vs/base/browser/imeEnter.ts`
		);

		expect(keybar).toContain("from '../../base/browser/stickyModifiers.js'");
		// imeEnter.ts already sits in base/browser, so its path is a sibling one.
		expect(ime).toContain("from './stickyModifiers.js'");
		// The keybar keeps no modifier state of its own.
		expect(keybar).not.toMatch(/private .*modifiers = new Map/);
	});

	// The keybar's whole visibility rule rides on upstream's isIOS being true for an
	// iPad, which reports itself as a Mac since iPadOS 13. If a bump ever drops the
	// maxTouchPoints half of that test, the bar silently never appears on iPad.
	test("upstream isIOS still detects an iPad reporting as a Mac", () => {
		const platform = readRepoFile(
			"packages/ide/upstream/lib/vscode/src/vs/base/common/platform.ts"
		);

		expect(platform).toMatch(
			/_isIOS = \(_userAgent\.indexOf\('Macintosh'\)[\s\S]{0,160}navigator\.maxTouchPoints > 0;/
		);
	});

	// Every key is one synthetic KeyboardEvent at the focused element - that is what
	// lets one bar serve the terminal and the workbench without importing
	// ITerminalService into vs/workbench/browser, which the layering rules forbid.
	test("keybar dispatches synthetic keys and imports no terminal service", () => {
		const keybar = readRepoFile(
			`${OVERLAY_VSCODE_SRC}/vs/workbench/browser/keybar.ts`
		);

		expect(keybar).toContain("new KeyboardEvent('keydown'");
		// xterm and StandardKeyboardEvent both read the legacy numeric field, which the
		// KeyboardEvent constructor drops.
		expect(keybar).toContain("keyCode: { value: keyCode }");
		expect(keybar).not.toMatch(/import .*ITerminalService/);
		expect(keybar).not.toMatch(/from '.*\/contrib\//);
	});

	// shell.js detects an open part via the workbench part-hidden classes; those
	// literals belong to upstream layout.ts and must survive upstream bumps.
	test("shell.js part-hidden classes exist upstream", () => {
		const shellJs = readRepoFile(`${ASSETS}/shell.js`);
		const layoutTs = readRepoFile(
			"packages/ide/upstream/lib/vscode/src/vs/workbench/browser/layout.ts"
		);

		for (const hiddenClass of ["nosidebar", "nopanel", "noauxiliarybar"]) {
			expect(shellJs).toContain(`"${hiddenClass}"`);
			expect(layoutTs).toContain(`'${hiddenClass}'`);
		}
	});

	// The sash grab-area default must key off the canonical touch gate (not a
	// second hardcoded query, and not iOS-only like upstream).
	test("touch-sash patch keys the sash size default off the touch gate", () => {
		const sashPatch = addedLines(readRepoFile(`${PATCHES_DIR}/touch.diff`));

		expect(sashPatch).toContain("touchGate.js");
		expect(sashPatch).toContain("isTouch(mainWindow) ? 20 : 4");
	});

	// Native selects on touch have exactly one decision point - the SelectBox
	// constructor, where touch overrides even an explicit useCustomDrawn - so no
	// call-site override can quietly bring the custom-drawn list back.
	test("touch-select patch keys the native-select decision off the touch gate", () => {
		const rawPatch = readRepoFile(`${PATCHES_DIR}/touch.diff`);
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
		const welcome = readRepoFile(`${PATCHES_DIR}/product.diff`);
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
		const logoPatch = readRepoFile(`${PATCHES_DIR}/product.diff`);
		const logoAdded = addedLines(logoPatch);

		expect(logoAdded).toContain(
			"background-color: var(--vscode-titleBar-activeForeground);"
		);
		expect(logoAdded).toContain(
			"mask: url('../../../media/code-icon.svg') center center / 20px no-repeat;"
		);
		// Scoped to the titlebar sections: product.diff also carries the theme
		// defaults, which legitimately name the composery-themes extension.
		const titlebarSections = logoPatch
			.split(/^(?=--- a\/)/m)
			.filter((section) =>
				section.startsWith(
					"--- a/lib/vscode/src/vs/workbench/browser/parts/titlebar/"
				)
			)
			.join("");
		expect(titlebarSections).not.toBe("");
		expect(titlebarSections).not.toContain("composery-theme");
		expect(logoAdded).not.toContain("background-size: 20px");
	});

	// The patch carries the mark's geometry by hand (a patch cannot import from
	// packages/shared), so every copy - the titlebar icon and each letterpress
	// watermark - is pinned to the generator here or the IDE keeps painting an
	// old shape after a redesign. The holes must stay a clip: as a nested <mask>
	// they go through a luminance step engines disagree on, and WebKit rendered
	// the hole edges soft where Blink kept them crisp (mushy mark on iOS only).
	test("patched icon SVGs match the shared icon geometry", () => {
		const shared = readRepoFile("packages/shared/index.ts");
		const iconPath = /const ICON_PATH =\s*"([^"]+)"/.exec(shared)?.[1];
		const holesPath = /const ICON_HOLES_PATH =\s*"([^"]+)"/.exec(shared)?.[1];
		expect(iconPath).toBeDefined();
		expect(holesPath).toBeDefined();

		const added = addedLines(readRepoFile(`${PATCHES_DIR}/product.diff`));
		const marks = [...added.matchAll(/<path d="([^"]+)"[^>]*clip-path=/g)];
		const holes = [...added.matchAll(/clip-rule="evenodd" d="([^"]+)"/g)];

		// Every letterpress variant plus the titlebar icon.
		expect(marks).toHaveLength(7);
		expect(holes).toHaveLength(7);
		for (const mark of marks) expect(mark[1]).toBe(iconPath);
		for (const hole of holes) expect(hole[1]).toBe(holesPath);
		expect(added).not.toContain("<mask id=");
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
	// fires for every request, deduped or not - which is also why it has to be
	// filtered: an editor opened in the background (a task revealing a file, an
	// extension opening its log, editors restored on reload) would otherwise take
	// the full-screen part away from the user, with nothing having asked it to.
	// Upstream's event carries only the editor and its group, so the options come
	// with it from the same patch.
	test("narrow fullscreen exits for editors meant to be looked at", () => {
		const added = addedLines(readRepoFile(`${PATCHES_DIR}/narrow.diff`));

		expect(added).toContain(
			"this.mainPartEditorService.onWillOpenEditor(e => {"
		);
		expect(added).toContain(
			"if (e.options?.preserveFocus || e.options?.inactive) {"
		);
		expect(added).toContain("readonly options?: IEditorOptions;");
		expect(added).toContain(
			"this._onWillOpenEditor.fire({ editor, groupId: this.id, options });"
		);
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
				addedLines(readRepoFile(`${PATCHES_DIR}/touch.diff`))
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

	// "The finger moved enough that this is a pan, not a tap" is one device-verified
	// magnitude, and two copies of it decided the same finger differently. It is now a
	// single exported constant: the gesture layer cancels the tap on it and the editor
	// classifies its own pan against the same import. Nothing may redeclare it, and
	// Gesture's release-time slop - a second, looser number that only ever disagreed
	// with the live verdict - is gone with it.
	test("one pan threshold decides press or scroll everywhere", () => {
		const patch = addedLines(readRepoFile(`${PATCHES_DIR}/touch.diff`));
		const declarations = patch.match(/PAN_THRESHOLD\s*=\s*(\d+)/g) ?? [];

		expect(declarations).toEqual(["PAN_THRESHOLD = 16"]);
		expect(patch).toContain("export const PAN_THRESHOLD = 16;");
		expect(patch).toContain(
			"data.initialPageY - touch.pageY) >= PAN_THRESHOLD"
		);
		expect(patch).toContain(
			"Math.hypot(this._touchGesture.totalX, this._touchGesture.totalY) >= PAN_THRESHOLD"
		);
		expect(patch).not.toMatch(/Math\.abs\(data\.initialPageX[^)]*\) < 30/);
	});

	// On touch the soft keyboard follows focus; a pan neither pops nor closes it, so the
	// old inputmode="none" keyboard-reopen suppressor is gone. Instead, transient overlays
	// stop dying to the keyboard's focus churn: quick input no longer hides on blur but on
	// a deliberate pointerdown outside it (press, not release, so a text-selection drag out
	// does not dismiss), and the context menu's blur/window-blur hides are gated off touch
	// (its outside MOUSE_DOWN and onDidCancel remain). One rule, both platforms - iOS's
	// focus-to-<body> simply is not an outside press.
	test("touch overlays dismiss on an outside press, and a pan never forces the keyboard", () => {
		const raw = readRepoFile(`${PATCHES_DIR}/touch.diff`);
		const patch = addedLines(raw);

		// The keyboard-reopen suppressor is fully removed - nothing writes inputmode on a pan.
		expect(raw).not.toContain("suppressKeyboardReopen");
		expect(raw).not.toContain("allowKeyboardReopen");
		expect(raw).not.toContain("'inputmode', 'none'");

		// Quick input: blur only hides off touch; a pointerdown outside the widget hides on touch.
		expect(patch).toContain(
			"if (!isTouch(mainWindow) && !this.getUI().ignoreFocusOut"
		);
		expect(patch).toContain("dom.EventType.POINTER_DOWN");
		expect(patch).toContain("!this.getUI().container.contains(target)");

		// Context menu: the focus-based hides are gated off touch, the press-based one stays.
		expect(patch).toContain("if (!isTouch(targetWindow))");
	});

	// Long-press menus fire during the hold (Gesture timer), and every context
	// menu renders in the light DOM on touch: one central gate in
	// ContextMenuHandler drops domForShadowRoot (menuAsChild dropdowns like the
	// settings gear, editor menus), because touch events retarget to a shadow
	// host - the surface under it steals focus back on the next touchstart and
	// the menu dies on blur - and the overlay touch styling cannot pierce a
	// shadow root. A pan remains a pan through release and inertia; it must
	// never fall back into the synthetic tap path or reach ancestor menus.
	test("touch-context-menu patch fires during the hold and gates shadow-root menus centrally", () => {
		const patch = addedLines(readRepoFile(`${PATCHES_DIR}/touch.diff`));

		expect(patch).toContain("contextMenuTimer");
		expect(patch).toContain("tapCancelled");
		// Press or scroll first, then long or short - the timer and its release fallback
		// both feed the one native-shaped contextmenu path.
		expect(patch).toContain(
			"if (holdTime >= Gesture.HOLD_DELAY) {\n\t\t\t\t\tthis.fireFallbackContextMenu(data);"
		);
		expect(patch).toContain(
			"data.contextMenuFired = true;\n\t\t\t\t\tthis.fireFallbackContextMenu(data);"
		);
		expect(patch).toContain(
			"this.newGestureEvent(EventType.Change, initialTarget)"
		);
		expect(patch).toContain(
			"isHTMLElement(delegate.domForShadowRoot) && !isTouch(mainWindow)"
		);
		// Central means central: the old per-call-site gates must stay gone, or
		// the rule regrows exceptions.
		expect(patch).not.toContain("EditorOption.useShadowDOM");
		// The OS cancels touches on app switch; without touchcancel cleanup the
		// stale entries kill the single-touch checks (long-press, inertia) forever.
		expect(patch).toContain("'touchcancel'");
		// The hold itself can re-render the pressed DOM (the editor word-selects
		// mid-hold) and detach initialTarget. The native re-fire must resolve the
		// live element under the finger and keep End on that same target.
		expect(patch).toContain("elementFromPoint");
		expect(patch).toContain("data.initialTarget = target;");
	});

	// Most workbench surfaces (the terminal, the titlebar, empty editor groups) open
	// their menus from native contextmenu listeners that a long-press never reaches:
	// Gesture targets preventDefault the touchstart and iOS synthesizes no contextmenu
	// at all. Gesture must re-fire exactly one real bubbling contextmenu from the
	// touched element, with semantic owners listening on that same native path.
	test("every long-press uses one native contextmenu path", () => {
		const raw = readRepoFile(`${PATCHES_DIR}/touch.diff`);
		const patch = addedLines(raw);

		// touch.ts: the timer and release fallback are the only two call sites, and
		// neither is conditional on a separate Gesture event being unconsumed.
		expect(patch.match(/this\.fireFallbackContextMenu\(data\);/g)).toHaveLength(
			2
		);
		expect(patch).not.toContain("holdEvt.defaultPrevented");
		expect(patch).not.toContain("evt.type === EventType.Contextmenu");
		expect(patch).toContain(
			"new MouseEvent('contextmenu', { bubbles: true, cancelable: true"
		);
		// ...never for editable fields (the OS selection toolbar owns those)...
		expect(patch).toContain("DomUtils.isEditableElement(target)");
		// ...and a release-time native echo (Windows fires its contextmenu on
		// finger-up) must not double the menu, while a during-hold native one
		// (Android outside Gesture targets) stands the timer down instead.
		expect(patch).toContain("suppressNativeContextMenuUntil");
		expect(patch).toContain(
			"data.contextMenuFired && data.syntheticContextMenu"
		);
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
		const removedLines = raw
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

		// The old event type and its typed DOM-map entry are deleted. The editor and
		// menu-item consumers capture native contextmenu instead, before ancestor menus.
		expect(removedLines).toContain(
			"export const Contextmenu = '-monaco-gesturecontextmenu';"
		);
		expect(removedLines).toContain(
			"'-monaco-gesturecontextmenu': GestureEvent;"
		);
		expect(patch).not.toMatch(
			/(?:TouchEventType|GestureEventType|EventType)\.Contextmenu/
		);
		expect(patch).not.toContain("-monaco-gesturecontextmenu");
		expect(patch).toContain(
			"this.viewHelper.viewDomNode, dom.EventType.CONTEXT_MENU, (e: MouseEvent) => this.onContextMenu(e), true"
		);
		// Chromium can re-hit-test the synthetic MouseEvent as content-empty even
		// while its DOM target is still the rendered token. The native listener
		// must consume Gesture's touchstart classification, not derive a second one.
		expect(patch).toContain("startedOnText: boolean;");
		expect(patch).toContain("if (gesture.startedOnText) {");
		expect(patch).toContain(
			"const target = this._createMouseTarget(editorEvent, false);"
		);
		expect(patch).not.toContain(
			"if (target.type === MouseTargetType.CONTENT_TEXT) {"
		);
		// Capture must not double ordinary desktop right-clicks. Touch-native and
		// untrusted fallback events use the capture path, and gutter holds are
		// deliberately presented as the editor menu without lying about the DOM target.
		expect(patch).toContain(
			"event.isTrusted && (event as PointerEvent).pointerType !== 'touch'"
		);
		expect(patch).toContain(
			"const target = this._createMouseTarget(editorEvent, true);"
		);
		expect(patch).toContain(
			"target.type === MouseTargetType.GUTTER_GLYPH_MARGIN"
		);
		expect(patch).toContain(
			"target: MouseTarget.createContentEmpty(target.element, target.mouseColumn, target.position, { isAfterLines: false })"
		);
		expect(patch).toContain("if (!e.isTrusted || e.pointerType === 'touch')");
		expect(patch).toContain(
			"eventType !== TouchEventType.Tap && eventType !== EventType.CONTEXT_MENU"
		);
	});

	// Janky event delivery (a busy phone, the app WebView) can hold a real pan's
	// touchmoves until after the 700ms hold timer fired: Gesture then called the
	// pan a long-press and ate every later move (dead scroll). The moves' own
	// timeStamps carry the finger's true timing, so a wrong verdict must revert.
	test("touch pan-revert corrects a hold verdict the event queue falsified", () => {
		const contextMenu = addedLines(readRepoFile(`${PATCHES_DIR}/touch.diff`));
		expect(contextMenu).toContain("initialEventTimeStamp: e.timeStamp");
		expect(contextMenu).toContain(
			"e.timeStamp - data.initialEventTimeStamp < Gesture.HOLD_DELAY"
		);
		expect(contextMenu).toContain(
			"mainWindow.dispatchEvent(new MouseEvent('mousedown'));"
		);
	});

	// Auto-focusing an editable because a surface became visible pops the
	// on-screen keyboard over the content the user came to see. Uniform rule for
	// every touch device, not upstream's per-site iOS exemptions.
	test("touch-autofocus keeps surface-open from popping the keyboard", () => {
		const patch = addedLines(readRepoFile(`${PATCHES_DIR}/touch.diff`));

		// extensions view search, SCM commit box, editor refocus on panel close
		expect(patch).toContain("if (!isTouch(mainWindow)) {");
		expect(patch).toContain(
			"this.tree.getFocus().length === 0 && !isTouch(mainWindow)"
		);
		expect(patch).toContain("!isTouch(mainWindow) &&");
	});

	// Prevent browser reveal only when the caller already owns reveal or is restoring
	// focus. Generic controls and settings-list keyboard navigation rely on native
	// reveal, so suppressing it can leave the focused control off screen.
	test("touch-reveal-guard stays scoped to focus restoration", () => {
		const patch = addedLines(readRepoFile(`${PATCHES_DIR}/touch.diff`));

		expect(patch).not.toContain("this.input.focus({ preventScroll: true });");
		expect(patch).not.toContain(
			"this.selectElement.focus({ preventScroll: true });"
		);
		expect(patch).not.toContain("selectedRow.focus({ preventScroll: true });");
		expect(patch).toContain(
			"this.focusToReturn?.focus({ preventScroll: true });"
		);
		expect(patch).toContain(
			"(<HTMLElement>control).focus({ preventScroll: true });"
		);
		expect(patch).toContain("rowElement.focus({ preventScroll: true })");
	});

	// window.ts blocks native contextmenus AND TextInputActionsProvider shows a themed input
	// menu - together they suppress the OS text-selection toolbar on touch, where it is the
	// better fit for a plain field and is what iOS shows anyway. Both must step aside for a real
	// editable control on touch; the code editor keeps its gesture menu (hidden input excluded),
	// and mouse/desktop keeps the themed menu.
	test("touch routes real editable controls to the native selection toolbar", () => {
		const patch = addedLines(readRepoFile(`${PATCHES_DIR}/touch.diff`));

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
		const touchMenu = addedLines(readRepoFile(`${PATCHES_DIR}/touch.diff`));
		const homeActions = addedLines(readRepoFile(`${PATCHES_DIR}/product.diff`));

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
	// visible-poll upstream itself uses for auxiliary windows. And on touch the
	// keyboard's native chrome drops window focus without the user leaving, so
	// hasFocus answers by visibility (present == active), not document.hasFocus().
	test("window-focus-resample patch samples interaction and late focus", () => {
		const patch = addedLines(
			readRepoFile(`${PATCHES_DIR}/window-focus-resample.diff`)
		);

		expect(patch).toContain("'pointerdown'");
		expect(patch).toContain("disposableWindowInterval");
		// Touch app-active == visible, not OS window focus.
		expect(patch).toContain("visibilityState === 'visible'");
		expect(patch).toContain("isTouch(getActiveWindow())");
	});

	// The two gates are defined once in the gate patches but mirrored - CSS and
	// overlay JS cannot import TS - in touch.css/.js, narrow.css/.js, and the
	// webview iframe CSS. Extract the canonical values from the gate patches and
	// require every mirror to match, so a query or breakpoint tweak cannot drift.
	test("overlay assets and patches mirror the canonical gate queries", () => {
		const touchQuery = /TOUCH_QUERY = '([^']+)'/.exec(
			readRepoFile(TOUCH_GATE)
		)?.[1];
		const narrowWidth = /NARROW_MAX_WIDTH = (\d+)/.exec(
			readRepoFile(NARROW_GATE)
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
		expect(readRepoFile(`${ASSETS}/shell.js`)).toContain(`"${touchQuery}"`);

		const narrowMedia = readRepoFile(`${ASSETS}/narrow.css`)
			.split("\n")
			.filter((line) => line.startsWith("@media"));
		expect(narrowMedia.length).toBeGreaterThan(0);
		for (const line of narrowMedia) {
			expect(line).toBe(`@media (max-width: ${narrowWidth}px) {`);
		}
		expect(readRepoFile(`${ASSETS}/shell.js`)).toContain(
			`NARROW_MAX_WIDTH = ${narrowWidth}`
		);
		expect(readRepoFile(`${PATCHES_DIR}/web-client.diff`)).toContain(
			`@media (max-width: ${narrowWidth}px)`
		);
	});

	// A wrong relative import path in a patch - a typo, or a stale one after the
	// imported file moves - only explodes at Docker-build time, and only for the
	// one import someone happened to notice. So resolve every relative import the
	// stack adds against the tree the build actually assembles: upstream, plus the
	// overlay copied over it, plus whatever the series itself creates.
	test("every patched relative import resolves in the assembled tree", () => {
		// The specifiers are runtime `.js`; the sources are `.ts`, or `.css` for a
		// style side-effect import.
		const EXTENSIONS = [".ts", ".d.ts", ".js", ".css"];
		const created = new Set(
			seriesNames.flatMap((name) =>
				[
					...readRepoFile(`${PATCHES_DIR}/${name}`).matchAll(
						/^--- \/dev\/null\n\+\+\+ b\/(.+)$/gm
					)
				].map((match) => match[1])
			)
		);

		const resolves = (path: string) =>
			EXTENSIONS.some(
				(extension) =>
					existsSync(
						resolve(repoRoot, "packages/ide/upstream", path + extension)
					) ||
					existsSync(
						resolve(repoRoot, "packages/ide/overlay", path + extension)
					) ||
					created.has(path + extension)
			);

		let imports = 0;
		for (const name of seriesNames) {
			let target = "";
			for (const line of readRepoFile(`${PATCHES_DIR}/${name}`).split("\n")) {
				const file = /^\+\+\+ b\/(.+)$/.exec(line);
				if (file?.[1]) target = file[1];

				// Both `import x from './y.js'` and a bare `import './y.js'`.
				const importPath = /^\+\s*(?:import|export)\b[^']*'(\.[^']*)';$/.exec(
					line
				)?.[1];
				if (!importPath) continue;

				imports++;
				const joined = posix.join(posix.dirname(target), importPath);
				expect(
					resolves(joined.replace(/\.js$/, "")),
					`${name}: ${target} imports ${importPath}, which resolves to nothing`
				).toBe(true);
			}
		}
		// The gates are the imports most likely to move; assert the stack still has
		// enough of them that an emptied loop cannot pass as a green check.
		expect(imports).toBeGreaterThan(50);
		expect(existsSync(resolve(repoRoot, TOUCH_GATE))).toBe(true);
		expect(existsSync(resolve(repoRoot, NARROW_GATE))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Mobile viewport contract: every top-level HTML surface we serve declares the
// same viewport capabilities.
//
// Top-level only, and that is the whole rule. Chromium processes a viewport meta
// and exposes env(safe-area-inset-*) for the main frame alone - measured on
// Android Chrome 134, a subframe declaring `width=500, viewport-fit=cover` laid
// out at its parent's 411px, exactly like a subframe declaring nothing, and read
// every inset as 0 while the top frame read a real 24px bottom inset. So a
// viewport meta on webview content (the pre page, the QR extension) is decoration
// that reads as configuration, and none of those surfaces belongs in this list.
// ---------------------------------------------------------------------------

const VIEWPORT_PARTS = [
	"viewport-fit=cover",
	"interactive-widget=resizes-content"
];

// Every viewport meta declared in a source, whatever surrounds it - the pages
// wrap the attributes over several lines and the patch keeps them on one.
const viewportMetas = (source: string) =>
	[...source.matchAll(/<meta\b[^>]*\bname="viewport"[^>]*>/g)]
		.map((meta) => /\bcontent="([^"]*)"/.exec(meta[0])?.[1])
		.filter((content) => content !== undefined);

describe("mobile viewport contract", () => {
	// Read the metas, not the file. Asserting the two parts appear *somewhere* in
	// the text passes just as happily on a file that declares three viewports and
	// fixes one - and web-client.diff is exactly that shape, since a patch also
	// carries the upstream lines it replaces.
	const surfaces: [path: string, read: (text: string) => string][] = [
		["packages/ide/overlay/src/browser/pages/error.html", (text) => text],
		["packages/ide/overlay/src/browser/pages/auth.html", (text) => text],
		["packages/ide/overlay/src/node/persistence/readiness.ts", (text) => text],
		[`${PATCHES_DIR}/web-client.diff`, addedLines]
	];

	test.each(surfaces)("%s declares the shared viewport parts", (path, read) => {
		const metas = viewportMetas(read(readRepoFile(path)));

		// A surface with no viewport meta at all would otherwise pass vacuously.
		expect(metas.length).toBeGreaterThan(0);
		for (const meta of metas) {
			for (const part of VIEWPORT_PARTS) {
				expect(meta, `${path}: ${meta}`).toContain(part);
			}
		}
	});

	// The other half of the rule: nothing we render into a webview declares one,
	// because it would do nothing there while reading as though it did.
	test("webview content declares no viewport of its own", () => {
		expect(
			viewportMetas(
				readRepoFile(
					"packages/ide/overlay/lib/vscode/extensions/composery-qr/extension.js"
				)
			)
		).toEqual([]);

		// One added viewport meta in the whole patch - the workbench page. A second
		// would mean a webview page grew one back.
		const patch = readRepoFile(`${PATCHES_DIR}/web-client.diff`);
		expect(viewportMetas(addedLines(patch))).toHaveLength(1);
		expect(patch).not.toContain("pre/fake.html");
	});
});

describe("adaptive favicon", () => {
	test.each([
		"packages/ide/overlay/src/browser/pages/auth.html",
		"packages/ide/overlay/src/browser/pages/error.html",
		`${PATCHES_DIR}/web-client.diff`
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

	test.each([
		[
			"packages/ide/overlay/src/browser/pages/auth.html",
			"src/browser/pages/favicon.js"
		],
		[
			"packages/ide/overlay/src/browser/pages/error.html",
			"src/browser/pages/favicon.js"
		],
		[`${PATCHES_DIR}/web-client.diff`, "src/browser/pages/favicon.js"]
	])(
		"%s hands the SVG favicon the scheme-pinned pair and the script that swaps it",
		(path, script) => {
			const raw = readRepoFile(path);
			const content = path.endsWith(".diff") ? addedLines(raw) : raw;

			// The adaptive file alone only ever caught up across a reload: Chromium
			// rasterizes a favicon once per URL and never re-runs the embedded
			// media query. The swap itself is driven in tests/favicon.test.ts.
			expect(content).toContain("favicon-light.svg");
			expect(content).toContain("favicon-dark.svg");
			expect(content).toContain(script);
		}
	);

	// One script for every surface, so the workbench and the auth pages cannot
	// drift into two behaviours. It lives with the pages because that is the path
	// all three can reach; the release step that carries pages JS across is what
	// puts it there, so pin that too.
	test("there is exactly one favicon script, and the release ships it", () => {
		expect(
			existsSync(
				resolve(
					repoRoot,
					"packages/ide/overlay/lib/vscode/out/vs/code/browser/workbench/workbench-assets/favicon.js"
				)
			),
			"a second favicon script under workbench-assets"
		).toBe(false);
		expect(readRepoFile("packages/ide/scripts/build.sh")).toContain(
			'cp "$BUILD/src/browser/pages/"*.js "$BUILD/release/src/browser/pages/"'
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
	const welcome = readRepoFile(`${PATCHES_DIR}/product.diff`);

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
	const shortcutsPatch = readRepoFile(`${PATCHES_DIR}/product.diff`);

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

type ApiKeysItem = {
	buttons?: Array<{ iconPath: { id: string }; tooltip: string }>;
	description?: string;
	detail?: string;
	kind?: number;
	label: string;
};

// A pick is either a label to accept, or a label whose item button to press.
type ApiKeysPick = string | { button: string };

type ApiKeysHarness = {
	clipboard: string[];
	commands: Map<string, () => Promise<void>>;
	errors: string[];
	execCalls: string[][];
	shown: Array<{
		items: ApiKeysItem[];
		placeholder: string | undefined;
		title: string | undefined;
	}>;
	warnings: string[];
};

function firstShown(harness: ApiKeysHarness) {
	const [shown] = harness.shown;
	if (!shown) {
		throw new Error("The picker was never shown");
	}
	return shown;
}

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
	picks?: ApiKeysPick[];
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
		shown: [],
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
		QuickPickItemKind: { Default: 0, Separator: -1 },
		ThemeIcon: class {
			id: string;
			constructor(id: string) {
				this.id = id;
			}
		},
		window: {
			// Drives one scripted pick per show(): the extension registers its
			// handlers before showing, so firing from show() needs no scheduling.
			createQuickPick() {
				const handlers: {
					accept?: () => void;
					button?: (event: { button: unknown; item: ApiKeysItem }) => void;
					hide?: () => void;
				} = {};
				const picker = {
					items: [] as ApiKeysItem[],
					placeholder: undefined as string | undefined,
					selectedItems: [] as ApiKeysItem[],
					title: undefined as string | undefined,
					dispose() {},
					hide() {
						handlers.hide?.();
					},
					onDidAccept(callback: () => void) {
						handlers.accept = callback;
						return { dispose() {} };
					},
					onDidHide(callback: () => void) {
						handlers.hide = callback;
						return { dispose() {} };
					},
					onDidTriggerItemButton(
						callback: (event: { button: unknown; item: ApiKeysItem }) => void
					) {
						handlers.button = callback;
						return { dispose() {} };
					},
					show() {
						harness.shown.push({
							items: picker.items,
							placeholder: picker.placeholder,
							title: picker.title
						});
						const pick = picks.shift();
						if (pick === undefined) {
							picker.hide();
							return;
						}
						const label = typeof pick === "string" ? pick : pick.button;
						const item = picker.items.find((entry) => entry.label === label);
						if (!item) {
							throw new Error(`No quick pick item labelled "${label}"`);
						}
						if (typeof pick === "string") {
							picker.selectedItems = [item];
							handlers.accept?.();
							return;
						}
						// A button the row never rendered cannot be pressed, so a
						// scripted press has to fail rather than fire the handler.
						const [button] = item.buttons ?? [];
						if (!button) {
							throw new Error(`No item button on "${label}"`);
						}
						handlers.button?.({ button, item });
					}
				};
				return picker;
			},
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
		contributes: {
			commands: Array<{ command: string; title: string; category?: string }>;
		};
		description: string;
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
		expect(addedLines(readRepoFile(`${PATCHES_DIR}/api.diff`))).toContain(
			"id: 'composery.manageApiKeys'"
		);
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
					prefix: "composery_abcd1234",
					secret: "composery_secret"
				},
				{
					keys: [
						{
							created_at: 1752710400,
							id: "k1",
							name: "ci",
							prefix: "composery_abcd1234"
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
		expect(harness.clipboard).toEqual(["composery_secret"]);
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
							prefix: "composery_abcd1234"
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

	test("every listed key advertises its revoke button below a separator", async () => {
		const { harness, run } = loadApiKeysExtension({
			responses: [
				{
					keys: [
						{
							created_at: 1752710400,
							id: "k1",
							name: "ci",
							prefix: "composery_abcd1234"
						},
						{
							created_at: 1752710400,
							id: "k2",
							name: "deploy",
							prefix: "composery_efgh5678"
						}
					]
				}
			]
		});

		await run();

		const { items } = firstShown(harness);
		expect(items.map((item) => item.label)).toEqual([
			"$(add) Create API Key",
			"",
			"ci",
			"deploy"
		]);
		// The separator only groups; the create action never carries a revoke.
		expect(items[1]?.kind).toBe(-1);
		expect(items[0]?.buttons).toBeUndefined();
		for (const item of items.slice(2)) {
			expect(item.buttons).toEqual([
				{ iconPath: { id: "trash" }, tooltip: "Revoke Key" }
			]);
		}
	});

	test("an empty list drops the separator and says so", async () => {
		const { harness, run } = loadApiKeysExtension({
			responses: [{ keys: [] }]
		});

		await run();

		const { items, placeholder } = firstShown(harness);
		expect(items.map((item) => item.label)).toEqual(["$(add) Create API Key"]);
		expect(placeholder).toBe("No API keys yet - create one to enable the API");
	});

	test("the revoke button revokes the key it sits on", async () => {
		const { harness, run } = loadApiKeysExtension({
			modalAction: "Revoke",
			picks: [{ button: "deploy" }],
			responses: [
				{
					keys: [
						{
							created_at: 1752710400,
							id: "k1",
							name: "ci",
							prefix: "composery_abcd1234"
						},
						{
							created_at: 1752710400,
							id: "k2",
							name: "deploy",
							prefix: "composery_efgh5678"
						}
					]
				},
				{ id: "k2", revoked: true },
				{ keys: [] }
			]
		});

		await run();

		expect(harness.warnings[0]).toBe('Revoke API key "deploy"?');
		expect(harness.execCalls[1]).toEqual([
			"composery",
			"api",
			"key",
			"revoke",
			"k2",
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
							prefix: "composery_abcd1234"
						}
					]
				},
				{
					keys: [
						{
							created_at: 1752710400,
							id: "k1",
							name: "ci",
							prefix: "composery_abcd1234"
						}
					]
				}
			]
		});

		await run();

		expect(harness.execCalls.map((call) => call[3])).toEqual(["list", "list"]);
	});

	test("warns when the API is disabled, with the server's flag literal", async () => {
		const config = readRepoFile(
			"packages/ide/overlay/src/node/routes/api/config.ts"
		);
		expect(config).toContain("COMPOSERY_DISABLE_API");
		expect(extension).toContain("COMPOSERY_DISABLE_API");
		// The extension warns off its own read of the flag, so the server has to
		// disable on exactly the values the warning is shown for.
		expect(config).toContain('raw === "1" || raw === "true"');

		const { harness, run } = loadApiKeysExtension({
			env: { COMPOSERY_DISABLE_API: "true" },
			responses: [{ keys: [] }]
		});

		await run();

		expect(harness.warnings[0]).toContain("COMPOSERY_DISABLE_API=true");
	});

	test("an unrecognised value leaves the API reachable", async () => {
		// Both sides read the flag independently, so a typo that warned here
		// while the server kept serving (or the reverse) would be worse than
		// either state: the operator would trust the wrong one.
		const { harness, run } = loadApiKeysExtension({
			env: { COMPOSERY_DISABLE_API: "yes" },
			responses: [{ keys: [] }]
		});

		await run();

		expect(harness.warnings).toEqual([]);
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
	cloudBoxId,
	cloudOrigin,
	fleet,
	release,
	source = "https://github.com/sloikodavid/composery.git",
	version = "1.2.3"
}: {
	action?: string;
	cloudBoxId?: string;
	cloudOrigin?: string;
	fleet?: { version?: string | null };
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
		URL,
		fetch: (url: string) => {
			harness.fetchCalls.push(url);
			const body = url.includes("/api/cloud/") ? fleet : release;
			return Promise.resolve({
				ok: body !== undefined,
				json() {
					return Promise.resolve(body);
				}
			});
		},
		module: cjsModule,
		process: {
			env: {
				COMPOSERY_BUILD_SOURCE: source,
				COMPOSERY_BUILD_VERSION: version,
				COMPOSERY_CLOUD_BOX_ID: cloudBoxId,
				COMPOSERY_CLOUD_ORIGIN: cloudOrigin
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
		expect(readRepoFile(`${PATCHES_DIR}/product.diff`)).not.toContain(
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

	// A cloud box runs what the fleet's runtime channel resolved to, which lags
	// the latest GitHub release on purpose, and its owner cannot pull an image -
	// the website updates the box over SSH. Both halves of the GitHub answer are
	// therefore wrong there: the version it compares against, and the page it
	// offers to open.
	const CLOUD = {
		cloudBoxId: "k17abc",
		cloudOrigin: "https://www.composery.io"
	};

	test("a cloud box asks the website and offers its own box page", async () => {
		const { activate, harness } = loadUpdatesExtension({
			...CLOUD,
			action: "View Box",
			fleet: { version: "1.3.0" },
			release: {
				html_url:
					"https://github.com/sloikodavid/composery/releases/tag/v9.9.9",
				prerelease: false,
				tag_name: "v9.9.9"
			}
		});

		activate({ subscriptions: [] });
		await flushUpdatesExtension();

		// The GitHub release is deliberately newer than the fleet's: whichever
		// version is announced says which oracle was consulted.
		expect(harness.fetchCalls).toEqual([
			"https://www.composery.io/api/cloud/runtime"
		]);
		expect(harness.messages).toEqual([
			"Composery 1.3.0 is available for this box. You have 1.2.3. Update it from the box's page on Composery Cloud."
		]);
		expect(harness.opened).toEqual(["https://www.composery.io/boxes/k17abc"]);
	});

	test("a cloud box that is on the fleet release says only that", async () => {
		const { activate, harness } = loadUpdatesExtension({
			...CLOUD,
			fleet: { version: "1.2.3" }
		});

		activate({ subscriptions: [] });
		await flushUpdatesExtension();
		harness.commands.get("composery.checkForUpdates")?.();
		await flushUpdatesExtension();

		expect(harness.messages).toEqual([
			"Composery 1.2.3 is the current Composery Cloud release."
		]);
	});

	test("an unreachable website never falls back to GitHub", async () => {
		const { activate, harness } = loadUpdatesExtension({
			...CLOUD,
			release: {
				html_url:
					"https://github.com/sloikodavid/composery/releases/tag/v1.3.0",
				prerelease: false,
				tag_name: "v1.3.0"
			}
		});

		activate({ subscriptions: [] });
		await flushUpdatesExtension();
		harness.commands.get("composery.checkForUpdates")?.();
		await flushUpdatesExtension();

		expect(harness.fetchCalls).toEqual([
			"https://www.composery.io/api/cloud/runtime",
			"https://www.composery.io/api/cloud/runtime"
		]);
		expect(harness.messages).toEqual([
			"Couldn't check for updates. You have Composery 1.2.3. Try again later."
		]);
	});

	test("a fleet release the website has not cached yet is not 'up to date'", async () => {
		const { activate, harness } = loadUpdatesExtension({
			...CLOUD,
			fleet: { version: null }
		});

		activate({ subscriptions: [] });
		await flushUpdatesExtension();
		harness.commands.get("composery.checkForUpdates")?.();
		await flushUpdatesExtension();

		expect(harness.messages).toEqual([
			"Couldn't check for updates. You have Composery 1.2.3. Try again later."
		]);
	});

	test("a cloud box with no origin checks nothing at all", async () => {
		// Half a pair is a misconfigured cloud box, not a self-hosted one. Asking
		// GitHub would answer a question about an image this owner cannot install.
		const { activate, harness } = loadUpdatesExtension({
			cloudBoxId: CLOUD.cloudBoxId,
			release: {
				html_url:
					"https://github.com/sloikodavid/composery/releases/tag/v1.3.0",
				prerelease: false,
				tag_name: "v1.3.0"
			}
		});

		activate({ subscriptions: [] });
		await flushUpdatesExtension();
		harness.commands.get("composery.checkForUpdates")?.();
		await flushUpdatesExtension();

		expect(harness.fetchCalls).toEqual([]);
		expect(harness.messages).toEqual([
			"Couldn't check for updates. You have Composery 1.2.3. Try again later."
		]);
	});

	test("the box's two cloud URLs match what the website serves", () => {
		// Neither the endpoint nor the box path can be imported here (the box runs
		// them as plain CommonJS against a website in another package), so pin the
		// spellings to the files that answer them.
		expect(
			existsSync(
				resolve(repoRoot, "packages/web/app/api/cloud/runtime/route.ts")
			)
		).toBe(true);
		expect(extension).toContain('new URL("/api/cloud/runtime"');
		expect(readRepoFile("packages/web/lib/box-route.ts")).toContain(
			"return `/boxes/${boxId}`"
		);
		expect(extension).toContain("`/boxes/${CLOUD_BOX_ID}`");
	});

	test("the public endpoint exposes the fleet release and nothing about the fleet", () => {
		// Unauthenticated and reachable by anyone, so what it can read is the
		// guard. It carries the current image digest and version label, because a
		// box compares its own COMPOSERY_RUNTIME_IMAGE against that digest and the
		// two Composery surfaces must not disagree about the same box. The digest
		// is the content address of a public image, not a credential.
		//
		// What must never appear is anything about the *fleet's policy*: the
		// minimum-version floor and its deadline are staff decisions, and a route
		// that reached for the settings object would hand them out. Comments are
		// stripped first because they name those things to explain their absence,
		// and an assertion that cannot tell prose from code would report on the
		// wrong thing.
		const route = readRepoFile(
			"packages/web/app/api/cloud/runtime/route.ts"
		).replace(/^\s*\/\/.*$/gm, "");
		expect(route).toContain("api.boxes.runtimeRelease.fleetVersion");
		for (const withheld of ["deadline", "minimum", "readGlobalSettings"]) {
			expect(route, withheld).not.toContain(withheld);
		}

		const query = readRepoFile("packages/web/convex/boxes/runtimeRelease.ts");
		const start = query.indexOf("export const fleetVersion");
		expect(start).toBeGreaterThanOrEqual(0);
		// Comments stripped for the same reason as the route above: this query's
		// own comment names the floor and its deadline to explain why neither is
		// returned, and an assertion that cannot tell prose from code would fail on
		// the explanation rather than on the behaviour.
		const body = query
			.slice(start, query.indexOf("\n});", start))
			.replace(/^\s*\/\/.*$/gm, "");
		// The `returns` validator is the real gate: whatever the handler builds,
		// Convex will not send a field this does not name.
		expect(body).toContain("settings.runtimeRelease?.version ?? null");
		expect(body).toContain("settings.runtimeRelease?.image ?? null");
		for (const withheld of ["minimumRuntime", "deadline", "checkout"]) {
			expect(body, withheld).not.toContain(withheld);
		}
	});

	// The box can only compare digests if the website tells it which one it was
	// started as; an image cannot contain its own digest. This pins the two ends
	// of that: the env file the website renders, and the variable the extension
	// reads.
	test("the website tells a cloud box which digest it is running", () => {
		const artifacts = readRepoFile(
			"packages/web/convex/boxes/infra/runtimeArtifacts.ts"
		);
		expect(artifacts).toContain("COMPOSERY_RUNTIME_IMAGE=");
		// Managed, so a box owner's own configuration can never overwrite it and
		// make the box lie about what it runs.
		expect(artifacts).toMatch(
			/MANAGED_ENV_KEYS[\s\S]*"COMPOSERY_RUNTIME_IMAGE"/
		);
		expect(extension).toContain("process.env.COMPOSERY_RUNTIME_IMAGE");
	});
});

describe("custom editors", () => {
	// The service that registers every contributed editor (Image Preview,
	// notebooks, anything an extension contributes) is built by one startup
	// contribution that never touches it. Delayed hands that contribution a proxy
	// backed by a timeout-less requestIdleCallback, which a window started in a
	// hidden tab never gets - so nothing registers for that window's whole life.
	test("the contributed-editor service is built at startup, not on idle", () => {
		const patch = readRepoFile(`${PATCHES_DIR}/custom-editors.diff`);

		expect(patch).toContain(
			"-registerSingleton(ICustomEditorService, CustomEditorService, InstantiationType.Delayed);"
		);
		expect(patch).toContain(
			"+registerSingleton(ICustomEditorService, CustomEditorService, InstantiationType.Eager);"
		);
	});

	// Eager only helps because a BlockStartup contribution depends on the service.
	// If upstream ever drops that argument, the service goes back to being built
	// by whoever happens to ask first - which is the bug, one step removed.
	test("a startup contribution still depends on the service", () => {
		const factory = readRepoFile(
			"packages/ide/upstream/lib/vscode/src/vs/workbench/contrib/customEditor/browser/customEditorInputFactory.ts"
		);
		const contribution = readRepoFile(
			"packages/ide/upstream/lib/vscode/src/vs/workbench/contrib/customEditor/browser/customEditor.contribution.ts"
		);

		expect(factory).toContain("@ICustomEditorService _customEditorService");
		expect(contribution).toContain(
			"registerWorkbenchContribution2(ComplexCustomWorkingCopyEditorHandler.ID, ComplexCustomWorkingCopyEditorHandler, WorkbenchPhase.BlockStartup)"
		);
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

	// Apply the patch's theme-service section alone onto the pristine upstream
	// file, so the assertions run against exactly what the build tree contains
	// after quilt. product.diff spans many files; only this one is seeded.
	const patchedThemeService = (): string => {
		const shadow = mkdtempSync(resolve(tmpdir(), "composery-theme-"));
		try {
			const dst = resolve(shadow, themeServiceRel);
			mkdirSync(posix.dirname(dst.replaceAll("\\", "/")), { recursive: true });
			copyFileSync(
				resolve(repoRoot, "packages/ide/upstream", themeServiceRel),
				dst
			);
			const section = readRepoFile(`${PATCHES_DIR}/product.diff`)
				.split(/^(?=--- a\/)/m)
				.filter((part) => part.startsWith(`--- a/${themeServiceRel}`))
				.join("");
			expect(section).not.toBe("");
			const sectionFile = resolve(shadow, "theme-section.diff");
			writeFileSync(sectionFile, section);
			applyPatch(sectionFile, shadow);
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
		const added = addedLines(readRepoFile(`${PATCHES_DIR}/product.diff`));
		expect(added).toContain("padding-top: 4px;");
		expect(added).toContain("padding-bottom: 4px;");
	});
});

// A row resize moves the xterm viewport, and nothing puts it back. Buffer#resize
// advances ydisp once per row it drops off the top, which is right while the
// viewport follows the bottom - the cursor has to stay visible, so the content
// moves up by exactly the height that was taken away - and wrong once the user
// has scrolled up to read, where it drags the text out from under them by that
// same height. A soft keyboard shrinking the panel is the cheapest way to see it;
// a sash drag does it on desktop too, which is why the patch is not touch-gated.
// Columns are not part of this: Buffer#_reflow returns immediately unless the
// column count changed, so a keyboard rewraps nothing.
describe("terminal resize scroll", () => {
	const patch = readRepoFile(`${PATCHES_DIR}/terminal.diff`);

	// Run the SHIPPED resize() rather than restating its arithmetic. The stand-in
	// xterm moves the viewport on resize the way xterm does and records what it is
	// asked to scroll, so what is asserted below is this patch's behaviour and not
	// a re-implementation of Buffer#resize agreeing with itself.
	const runResize = (viewportY: number, baseY: number, drift: number) => {
		const source = postImageLines(patch);
		const start = source.indexOf("\tresize(columns");
		const end = source.indexOf("\n\t}", start);
		expect(start, "resize() not found in the patch").toBeGreaterThan(-1);
		expect(end, "resize() has no closing brace in the hunk").toBeGreaterThan(
			start
		);

		const { run } = evaluatePatchSnippets<{
			run: (
				viewportY: number,
				baseY: number,
				drift: number
			) => { viewportY: number; scrolled: number[] };
		}>(
			[
				`class Term {
					constructor(raw) { this.raw = raw; this._logService = { debug() {} }; }
					${source.slice(start, end + 3)}
				}`,
				`function run(viewportY, baseY, drift) {
					const scrolled = [];
					const buffer = { viewportY, baseY };
					const raw = {
						buffer: { active: buffer },
						// xterm walks ydisp along with ybase for every row it drops or
						// gains, wherever the viewport happened to be sitting.
						resize: () => { buffer.viewportY += drift; buffer.baseY += drift; },
						scrollLines: (lines) => { scrolled.push(lines); buffer.viewportY += lines; }
					};
					new Term(raw).resize(80, 18);
					return { viewportY: buffer.viewportY, scrolled };
				}`
			],
			["run"]
		);
		return run(viewportY, baseY, drift);
	};

	test("a scrolled-up viewport does not move when the pane shrinks", () => {
		// Reading history 60 rows back, keyboard takes 16 rows: the text stays put
		// and the keyboard simply covers the rows below it.
		expect(runResize(40, 100, 16)).toEqual({ viewportY: 40, scrolled: [-16] });

		// And back, when the keyboard closes and the rows return.
		expect(runResize(40, 100, -16)).toEqual({ viewportY: 40, scrolled: [16] });
	});

	test("a viewport following the bottom keeps following it", () => {
		// The cursor has to clear the keyboard, so this one is supposed to move -
		// xterm already did it, and nothing here may undo that.
		expect(runResize(100, 100, 16)).toEqual({ viewportY: 116, scrolled: [] });
	});

	test("the alternate screen is never scrolled", () => {
		// No scrollback means viewportY and baseY are both pinned at 0, so the same
		// "was it following the bottom" question answers this without a second rule.
		expect(runResize(0, 0, 0)).toEqual({ viewportY: 0, scrolled: [] });
	});
});

// The keyboard-open signal the keybar reads (it reserves its row out of the grid
// only while a keyboard is up) is published by shell.js, and is deliberately NOT
// the existing inset var - that one means "overlap the viewport has not already
// excluded" and reads 0 under interactive-widget=resizes-content.
describe("soft-keyboard open signal", () => {
	test("shell.js publishes the keyboard-open signal from a viewport baseline", () => {
		const narrow = readRepoFile(
			"packages/ide/overlay/lib/vscode/out/vs/code/browser/workbench/workbench-assets/shell.js"
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

// A terminal is not prose: the on-screen keyboard must offer no dictionary
// suggestions and no autocorrect over shell input. xterm already sets autocorrect,
// autocapitalize and spellcheck off on its helper textarea, but on Android those
// three do not remove the suggestion strip - Chromium maps that strip (and the
// autocorrect it also overrides, via TYPE_TEXT_FLAG_NO_SUGGESTIONS) off only from
// autocomplete="off", which xterm omits. The patch sets it on the terminal's own
// textarea; harmless on desktop, where the attribute drives no soft keyboard.
describe("terminal soft-keyboard suggestions", () => {
	test("the terminal textarea opts out of suggestions and autocorrect", () => {
		const source = addedLines(readRepoFile(`${PATCHES_DIR}/touch.diff`));

		expect(source).toContain(
			"xterm.raw.textarea.setAttribute('autocomplete', 'off')"
		);
	});
});

// The mobile app overrides the page's colour scheme with a data-scheme attribute
// on <html>, because an Android WebView's native prefers-color-scheme tracks the
// activity theme rather than the system (see back-button.ts). Any page the app
// can put on screen therefore needs scheme CSS keyed on that attribute as well as
// on the media query - and the app tints its status-bar strip to whatever the page
// paints, so a page that misses the override shows a white bar over a dark app.
// The three copies live in three languages and cannot share a constant; this is
// what keeps them from drifting, as the readiness page already had.
describe("app scheme override", () => {
	const pages: [name: string, source: () => string][] = [
		[
			"workbench first paint",
			() => readRepoFile(`${PATCHES_DIR}/web-client.diff`)
		],
		[
			"auth and error pages",
			() => readRepoFile("packages/ide/overlay/src/browser/pages/brand.css")
		],
		[
			"persistence startup page",
			() =>
				readRepoFile("packages/ide/overlay/src/node/persistence/readiness.ts")
		]
	];

	test.each(pages)("%s keys its dark background on data-scheme", (_, read) => {
		const source = read();
		expect(source).toMatch(/\[data-scheme="dark"\]/);
		expect(source).toMatch(/\[data-scheme="light"\]/);
		// The media query stays for real browsers; the attribute is the override.
		expect(source).toContain("prefers-color-scheme");
	});
});

describe("persistence readiness cache", () => {
	test("uses monotonic elapsed time instead of the adjustable wall clock", () => {
		const source = readRepoFile(
			"packages/ide/overlay/src/node/persistence/readiness.ts"
		);
		expect(source.match(/performance\.now\(\)/g)).toHaveLength(2);
		expect(source).not.toMatch(/(?:cached\.at|at:)\s*Date\.now\(\)/);
	});
});

// Modified upstream files are patches, so quilt at fuzz=0 fails loudly when
// upstream moves under them. Whole files we own are copied over the tree
// instead, which has no such tripwire: if upstream ever ships a file at one of
// our overlay paths, the copy would silently replace it and the loss would look
// exactly like nothing happening. This is that tripwire.
describe("overlay never shadows an upstream file", () => {
	const OVERLAY_SRC = "packages/ide/overlay/lib/vscode/src";
	const UPSTREAM_SRC = "packages/ide/upstream/lib/vscode/src";

	function overlayFiles(dir: string, base = ""): string[] {
		const root = resolve(repoRoot, dir);
		if (!existsSync(root)) return [];
		return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
			const relative = base ? posix.join(base, entry.name) : entry.name;
			return entry.isDirectory()
				? overlayFiles(posix.join(dir, entry.name), relative)
				: [relative];
		});
	}

	test("every overlaid VS Code source file is one upstream does not have", () => {
		const files = overlayFiles(OVERLAY_SRC);

		// A green run here must mean the check ran, not that the tree was empty.
		expect(files.length).toBeGreaterThan(0);

		for (const file of files) {
			expect(
				existsSync(resolve(repoRoot, UPSTREAM_SRC, file)),
				`${file} exists upstream - it must be a patch, not an overlay file`
			).toBe(false);
		}
	});

	test("the build copies the overlaid VS Code sources onto the tree", () => {
		// An overlay directory nothing installs is a documented no-op: the files
		// would read as shipped while never reaching the build.
		expect(readRepoFile("packages/ide/scripts/build.sh")).toContain(
			'cp -r "$PACKAGE_ROOT/overlay/lib/vscode/src/." "$BUILD/lib/vscode/src/"'
		);
	});
});

// The installed PWA is the mobile story until the native apps ship, so the
// values that decide how it looks on a home screen are worth pinning: they live
// in an upstream file none of us reads by accident, and a wrong one is only
// visible after installing the app.
describe("PWA install metadata", () => {
	const patch = readRepoFile(`${PATCHES_DIR}/web-client.diff`);
	const added = addedLines(patch);
	const removed = patch
		.split(/\r?\n/)
		.filter((line) => line.startsWith("-") && !line.startsWith("---"))
		.join("\n");

	const background = (file: string): string =>
		(
			JSON.parse(
				readRepoFile(
					`packages/ide/overlay/lib/vscode/extensions/composery-themes/themes/${file}`
				)
			) as { colors: Record<string, string> }
		).colors["editor.background"]!;

	test("installs as a standalone window, not fullscreen", () => {
		expect(added).toContain('display: "standalone"');
		// Fullscreen hides the clock and battery; window-controls-overlay would
		// put the OS controls over a titlebar that reserves no room for them.
		expect(removed).toContain('display: "fullscreen"');
		expect(removed).toContain("display_override:");
		// The key, not the word: the patch's own comment explains the removal.
		expect(added).not.toContain("display_override:");
	});

	test("names the app what shared names it", () => {
		const brandName = /BRAND_NAME = "([^"]+)"/.exec(
			readRepoFile("packages/shared/index.ts")
		)?.[1];
		expect(brandName).toEqual(expect.any(String));

		// iOS writes this under the home-screen icon in preference to the
		// manifest's short_name, so it is the name most phones actually show.
		expect(added).toContain(
			`<meta name="apple-mobile-web-app-title" content="${brandName}">`
		);
		expect(removed).toContain('content="Code"');
	});

	test("describes the app the way the website does", () => {
		const description = /APP_DESCRIPTION =\s*"([^"]+)"/.exec(
			readRepoFile("packages/shared/index.ts")
		)?.[1];
		expect(description).toEqual(expect.any(String));
		expect(added).toContain(`"${description}"`);
	});

	test("splash and status bar are the theme backgrounds", () => {
		const dark = background("composery-dark.json");
		const light = background("composery-light.json");

		// One manifest colour, so it takes the dark background the launcher icon
		// tile also uses; the metas then track the scheme the workbench starts in.
		expect(added).toContain(`theme_color: "${dark}"`);
		expect(added).toContain(`background_color: "${dark}"`);
		expect(added).toContain(
			`<meta name="theme-color" content="${dark}" media="(prefers-color-scheme: dark)" />`
		);
		expect(added).toContain(
			`<meta name="theme-color" content="${light}" media="(prefers-color-scheme: light)" />`
		);
	});

	// The first-paint style sits directly beside those metas and is the colour a
	// cold load actually shows, but nothing tied it to the themes: it could drift
	// to a background the workbench then repaints a moment later, which reads as a
	// flash and is only visible on a slow connection.
	test("the pre-theme first paint is the theme background", () => {
		const dark = background("composery-dark.json");
		const light = background("composery-light.json");
		const firstPaint = /<style>([\s\S]*?)<\/style>/.exec(added)?.[1];
		expect(firstPaint).toEqual(expect.any(String));

		const colours = [
			...firstPaint!.matchAll(/background-color:\s*(#\w+)/g)
		].map((match) => match[1]);
		expect(colours.length).toBeGreaterThan(0);
		expect([...new Set(colours)].sort()).toEqual([light, dark].sort());
	});
});

// ---------------------------------------------------------------------------
// API terminals: the API creates ordinary persistent VS Code terminals through
// the pty host, so they show up in the editor like any other. The contracts
// below span the patch and the code-server-side routes, which compile
// separately and so cannot share a symbol.
// ---------------------------------------------------------------------------

describe("api terminals", () => {
	const patch = readRepoFile(`${PATCHES_DIR}/api.diff`);
	const terminals = readRepoFile(
		"packages/ide/overlay/src/node/routes/api/terminals.ts"
	);
	const flowControl = readRepoFile(
		"packages/ide/overlay/lib/vscode/src/vs/platform/terminal/common/terminalDataFlowControl.ts"
	);

	test("the workspace sentinel is identical on both sides", () => {
		// A terminal created outside any editor window carries this instead of a
		// real workspace id. If the two copies drift, the pty host stops matching
		// API terminals into any window's layout and they silently never appear.
		const inPatch = /API_TERMINAL_WORKSPACE_ID = '([^']+)'/.exec(
			addedLines(patch)
		);
		const inRoutes = /API_TERMINAL_WORKSPACE_ID = "([^"]+)"/.exec(terminals);
		expect(inPatch?.[1]).toBeDefined();
		expect(inRoutes?.[1]).toBe(inPatch?.[1]);
	});

	test("the API terminal env matches what an editor terminal is given", () => {
		// addTerminalEnvironmentKeys lives in the workbench bundle, which this
		// server cannot import, so terminals.ts sets the keys itself. Read the real
		// upstream function and require the same ones, or an API terminal quietly
		// renders differently from the identical terminal opened with `+`.
		const upstream = readRepoFile(
			"packages/ide/upstream/lib/vscode/src/vs/workbench/contrib/terminal/common/terminalEnvironment.ts"
		);
		const body = upstream.slice(
			upstream.indexOf("export function addTerminalEnvironmentKeys")
		);
		const keys = [
			...body.slice(0, body.indexOf("\n}")).matchAll(/env\['(\w+)'\]/g)
		]
			.map((match) => match[1])
			// TERM_PROGRAM_VERSION and LANG need the product version and the client
			// locale; neither reaches this server, and both are absent on purpose.
			.filter((key) => key !== "TERM_PROGRAM_VERSION" && key !== "LANG");
		expect(keys.length).toBeGreaterThan(0);
		for (const key of keys) {
			expect(terminals, `terminals.ts is missing ${key}`).toContain(key);
		}
	});

	test("a deliberately detached terminal is not synced back", () => {
		// terminal-sync merges every persistent process for a workspace into each
		// client's layout. Detach Session works by scheduling the disconnect
		// runners - there is no detached flag - so without this guard the next
		// layout request re-adopts the terminal and a client attaching cancels the
		// disconnect, silently undoing the detach.
		const added = addedLines(patch);
		expect(added).toContain("process.isDetaching");
		expect(added).toMatch(
			/get isDetaching\(\).*_disconnectRunner1\.isScheduled\(\) \|\| this\._disconnectRunner2\.isScheduled\(\)/
		);
	});

	test("the pty host is reached through the server API, not rebuilt", () => {
		// The point of the patch: one field exposing VS Code's own pty host. If
		// terminals.ts ever spawns its own pty again it is a parallel terminal
		// implementation, which is what this whole thing exists to avoid.
		expect(addedLines(patch)).toContain("readonly ptyService: IPtyService");
		expect(terminals).toContain("createProcess(");
		expect(terminals).not.toContain("node-pty");
		expect(terminals).not.toContain("child_process");
		expect(terminals).not.toContain("spawn(");
	});

	test("API terminals announce themselves to live editor clients", () => {
		const added = addedLines(patch);
		expect(added).toContain(
			"this._register(this._ptyHostService.onProcessReady"
		);
		expect(added).toContain("this._ptyHostService.listProcesses(true)");
		expect(added).toContain(
			"this._onPersistentTerminalInventoryChange.fire({ workspaceId: process.workspaceId })"
		);
	});

	test("a second output consumer cannot acknowledge broadcast bytes twice", () => {
		const added = addedLines(patch);
		expect(added).toContain(
			"registerDataConsumer(id: number, consumerId: string)"
		);
		expect(added).toContain(
			"acknowledgeDataEvent(id: number, charCount: number, consumerId?: string)"
		);
		expect(
			added.match(/unregisterDataConsumer\([^;\n]*'vscode'\)/g)
		).toHaveLength(2);
		expect(flowControl).toContain("consumerId === this._leader");
		expect(flowControl).toContain("this._acknowledge(delta)");
		// Nothing arbitrates a counter it is never told about.
		expect(added).toContain("this._dataFlowControl.acceptData(e.length)");
	});

	test("the API never takes the consumer id the editor's own frontends share", () => {
		// One id covers every VS Code frontend, because they have no registration
		// call and the pty host names them. An API attach reusing it would land in
		// that same slot, so either side detaching would strip the other's flow
		// control - and the pty would then pause on bytes nobody can acknowledge.
		const added = addedLines(patch);
		const unregistered = [
			...added.matchAll(/unregisterDataConsumer\([^;\n]*'([^']+)'\)/g)
		].map((match) => match[1]);
		const fallback =
			/acknowledgeDataEvent\(id: number, charCount: number, consumerId: string = '([^']+)'\)/.exec(
				added
			)?.[1];

		expect(fallback).toBeDefined();
		expect(new Set([...unregistered, fallback]).size).toBe(1);

		const apiIds = [...terminals.matchAll(/consumerId = `([^`$]+)\$\{/g)].map(
			(match) => match[1]
		);
		expect(apiIds).toHaveLength(2);
		for (const id of apiIds) expect(id).not.toBe(fallback);
	});

	test("the orphan check keeps upstream's default and its own polarity", () => {
		// terminal.diff's fourth `_buildProcessDetails` argument is `checkOrphan`,
		// where true means run the check - and that check asks every renderer and
		// waits on a 4s barrier for an answer. A pass-through named for the
		// opposite meaning inverts both callers at once: the editor quietly loses
		// a check it had, and the API pays four seconds for one it never wanted.
		const added = addedLines(patch);
		expect(added).toContain(
			"async serializeTerminalState(ids: number[], checkOrphan: boolean = true)"
		);
		expect(added).not.toMatch(/skipOrphan/i);
		expect(terminals).toContain("serializeTerminalState([id], false)");
	});

	test("websocket attach subscribes to replay before asking the pty to emit it", () => {
		const route = terminals.slice(
			terminals.indexOf("wsRouter.ws(`${apiBasePath}/terminals/:id`")
		);
		const replay = route.indexOf("pty.onProcessReplay");
		const start = route.indexOf(".then(() => pty.start(id))");
		expect(replay).toBeGreaterThan(-1);
		expect(start).toBeGreaterThan(replay);
		expect(route).toContain(
			"for (const replay of event.events) send(replay.data, false)"
		);
	});
});

// Our first-run layout defaults are the one place a "good default" can quietly
// become something the user cannot undo, because they are expressed against
// upstream's own persisted state rather than a setting they can see. Both of
// these guard the mechanism, not the taste: which containers we start with is
// free to change, how the choice is stored is not.
describe("default layout", () => {
	const compositeBarRel =
		"lib/vscode/src/vs/workbench/browser/parts/paneCompositeBar.ts";

	const patchedCompositeBar = (): string => {
		const shadow = mkdtempSync(resolve(tmpdir(), "composery-layout-"));
		try {
			const dst = resolve(shadow, compositeBarRel);
			mkdirSync(posix.dirname(dst.replaceAll("\\", "/")), { recursive: true });
			copyFileSync(
				resolve(repoRoot, "packages/ide/upstream", compositeBarRel),
				dst
			);
			const section = readRepoFile(`${PATCHES_DIR}/product.diff`)
				.split(/^(?=--- a\/)/m)
				.filter((part) => part.startsWith(`--- a/${compositeBarRel}`))
				.join("");
			expect(section).not.toBe("");
			const sectionFile = resolve(shadow, "composite-bar-section.diff");
			writeFileSync(sectionFile, section);
			applyPatch(sectionFile, shadow);
			return readFileSync(dst, "utf8").replaceAll("\r\n", "\n");
		} finally {
			rmSync(shadow, { recursive: true, force: true });
		}
	};

	// A container is on its bar when it is PINNED - that is the state the bar's
	// own context menu toggles and the only one persisted profile-wide. Deciding
	// this anywhere else re-runs the id list against state the user has since
	// changed: keying off `visible` instead re-hid the container on every reload
	// (it is workspace-scoped and re-derived from shouldBeHidden), and deciding
	// it in shouldBeHidden re-hid it mid-session on any view-descriptor change.
	// So: consulted exactly once, at the one call site that knows the container
	// is new to this profile.
	test("default-hidden containers are decided once, by not pinning", () => {
		const patched = patchedCompositeBar();
		const uses = patched.split("COMPOSERY_DEFAULT_HIDDEN_CONTAINER_IDS");

		// One declaration, one read - a second read is a second chance to
		// override a choice the user has already made.
		expect(uses).toHaveLength(3);
		expect(uses[1]).toContain("new Set<string>(");
		expect(patched).toContain(
			"if (!cachedViewContainer && !COMPOSERY_DEFAULT_HIDDEN_CONTAINER_IDS.has(viewContainer.id)) {\n\t\t\t\tthis.compositeBar.pin(viewContainer.id);"
		);

		// Hiding by any other mechanism does not survive a reload.
		expect(patched).not.toContain(
			"COMPOSERY_DEFAULT_HIDDEN_CONTAINER_IDS.has(viewContainerId)"
		);
	});

	// Where a container lives is a layout opinion, not a default: unlike pinned
	// state there is no UI that reads as "put this back", and it was seeded into
	// per-browser storage, so the same box looked different on a second device.
	test("no patch seeds view container locations", () => {
		for (const patch of readdirSync(resolve(repoRoot, PATCHES_DIR))) {
			if (!patch.endsWith(".diff")) continue;
			expect(
				addedLines(readRepoFile(`${PATCHES_DIR}/${patch}`)),
				patch
			).not.toContain("viewContainerLocations");
		}
	});
});
