import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, test, vi } from "vitest";

const host = vi.hoisted<{
	app: unknown;
	android: string;
	current: Map<string, string>;
	readiness: string;
	writes: Array<{ path: string; contents: string }>;
}>(() => ({
	app: null,
	android: 'const ACCENT = { light: "#111111", dark: "#222222" };',
	current: new Map(),
	readiness:
		'const page = \'<style>body{margin:0;background:#111111;color:#222222}@media (prefers-color-scheme:dark){body{background:#333333;color:#444444}}html[data-scheme="light"] body{background:#555555;color:#666666}html[data-scheme="dark"] body{background:#777777;color:#888888}</style>\';',
	writes: []
}));

const app = {
	expo: {
		android: { adaptiveIcon: { backgroundColor: "#111111" } },
		plugins: [
			"unrelated",
			[
				"not-splash",
				{
					backgroundColor: "#444444",
					dark: { backgroundColor: "#555555" }
				}
			],
			[
				"expo-splash-screen",
				{
					backgroundColor: "#222222",
					dark: { backgroundColor: "#333333" }
				}
			]
		]
	}
};
const syncedApp = {
	expo: {
		android: { adaptiveIcon: { backgroundColor: "#0a0a0a" } },
		plugins: [
			"unrelated",
			[
				"not-splash",
				{
					backgroundColor: "#444444",
					dark: { backgroundColor: "#555555" }
				}
			],
			[
				"expo-splash-screen",
				{
					backgroundColor: "#ffffff",
					dark: { backgroundColor: "#0a0a0a" }
				}
			]
		]
	}
};

vi.mock("node:fs/promises", () => ({
	readFile: (path: string, encoding: string) => {
		if (encoding !== "utf8")
			throw new Error(`Unexpected encoding: ${encoding}`);
		const normalized = path.replaceAll("\\", "/");
		if (host.current.has(normalized))
			return Promise.resolve(host.current.get(normalized));
		if (normalized.endsWith("/persistence/readiness.ts"))
			return Promise.resolve(host.readiness);
		if (normalized.endsWith("/plugins/android-dialog-theme.js"))
			return Promise.resolve(host.android);
		if (normalized === `${slash(repoRoot)}/packages/mobile/app.json`)
			return Promise.resolve(JSON.stringify(host.app, null, "\t"));
		return Promise.resolve(null);
	},
	writeFile: (path: string, contents: string) => {
		host.writes.push({ path, contents });
		return Promise.resolve();
	}
}));

vi.mock("../../../../../scripts/write-formatted.mjs", () => ({
	formatContent: (_path: string, contents: string) => Promise.resolve(contents)
}));

const slash = (path: string) => path.replaceAll("\\", "/");
const repoRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../../.."
);

async function run(check = false) {
	host.writes.length = 0;
	vi.resetModules();
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
	const {
		syncAssets
	}: { syncAssets: (options: { check: boolean }) => Promise<void> } =
		// @ts-expect-error The behavior-tested JavaScript entry point has no declaration file.
		await import("../../../scripts/sync.mjs");
	const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
	try {
		await syncAssets({ check });
		return log.mock.calls;
	} finally {
		log.mockRestore();
	}
}

function output(path: RegExp) {
	const match = host.writes.find((entry) => path.test(slash(entry.path)));
	expect(match).not.toBeUndefined();
	return match?.contents ?? "";
}

beforeEach(() => {
	host.current = new Map();
	host.android = 'const ACCENT = { light: "#111111", dark: "#222222" };';
});

describe("text brand asset generator", () => {
	test("derives CSS, favicons, native colors, and startup literals from one theme", async () => {
		host.app = structuredClone(app);
		const logs = await run();

		expect(
			host.writes.map(({ path }) =>
				slash(path).replace(/^.*\/packages\//, "packages/")
			)
		).toEqual([
			"packages/web/app/brand.css",
			"packages/ide/overlay/src/browser/pages/brand.css",
			"packages/ide/overlay/src/node/persistence/readiness.ts",
			"packages/mobile/plugins/android-dialog-theme.js",
			"packages/web/app/icon.svg",
			"packages/web/public/icon-light.svg",
			"packages/web/public/icon-dark.svg",
			"packages/ide/overlay/src/browser/media/favicon.svg",
			"packages/ide/overlay/src/browser/media/favicon-light.svg",
			"packages/ide/overlay/src/browser/media/favicon-dark.svg",
			"packages/mobile/app.json"
		]);
		expect(slash(host.writes[0]!.path)).toBe(
			`${slash(repoRoot)}/packages/web/app/brand.css`
		);

		const webCss = output(/packages\/web\/app\/brand\.css$/);
		expect(webCss).toContain(`:root {
	--background: #ffffff;
	--foreground: #000000;
	--card: #ffffff;
	--card-foreground: #000000;
	--popover: #ffffff;
	--popover-foreground: #000000;
	--primary: #171717;
	--primary-foreground: #fafafa;
	--secondary: #f5f5f5;
	--secondary-foreground: #171717;
	--muted: #f5f5f5;
	--muted-foreground: #737373;
	--accent: #f5f5f5;
	--accent-foreground: #171717;
	--destructive: #dc2626;
	--success: #16a34a;
	--warning: #dc8a06;
	--info: #2563eb;
	--border: #e5e5e5;
	--input: #e5e5e5;
	--ring: #a3a3a3;
	--overlay: #00000066;
	--chart-1: #171717;
	--chart-2: #525252;
	--chart-3: #737373;
	--chart-4: #a3a3a3;
	--chart-5: #d4d4d4;
}`);
		expect(webCss).toContain(`.dark {
	--background: #0a0a0a;
	--foreground: #fafafa;`);

		const ideCss = output(
			/packages\/ide\/overlay\/src\/browser\/pages\/brand\.css$/
		);
		expect(ideCss).toContain(`	--vscode-button-background: #171717;
	--vscode-button-foreground: #fafafa;
	--vscode-button-hoverBackground: #737373;
	--vscode-focusBorder: #a3a3a3;
	--vscode-editor-background: #ffffff;
	--vscode-editorHoverWidget-background: #ffffff;
	--vscode-editorHoverWidget-border: #e5e5e5;
	--vscode-editorHoverWidget-foreground: #000000;
	--vscode-errorForeground: #dc2626;
	--vscode-descriptionForeground: #737373;
	--auth-success: #16a34a;
	--auth-warning: #dc8a06;
	--auth-input-focus: #a3a3a3;
	--vscode-foreground: #000000;
	--vscode-input-background: #ffffff;
	--vscode-input-border: #f5f5f5;
	--vscode-input-foreground: #000000;
	--vscode-toolbar-activeBackground: #73737350;
	--vscode-toolbar-hoverBackground: #f5f5f580;
	--vscode-shadow-hover: 0 2px 8px #00000026;`);
		expect(ideCss).toContain(`		--vscode-button-background: #fafafa;
		--vscode-button-foreground: #0a0a0a;
		--vscode-button-hoverBackground: #fafafa;
		--vscode-focusBorder: #737373;
		--vscode-editor-background: #0a0a0a;
		--vscode-editorHoverWidget-background: #171717;`);
		expect(ideCss).toContain("--vscode-shadow-hover: 0 2px 8px #0000005c;");
		expect(ideCss).toContain(':root[data-scheme="light"]');
		expect(ideCss).toContain(':root[data-scheme="dark"]');

		expect(
			output(/packages\/ide\/overlay\/src\/node\/persistence\/readiness\.ts$/)
		).toBe(
			'const page = \'<style>body{margin:0;background:#ffffff;color:#000000}@media (prefers-color-scheme:dark){body{background:#0a0a0a;color:#fafafa}}html[data-scheme="light"] body{background:#ffffff;color:#000000}html[data-scheme="dark"] body{background:#0a0a0a;color:#fafafa}</style>\';'
		);
		expect(output(/packages\/mobile\/plugins\/android-dialog-theme\.js$/)).toBe(
			'const ACCENT = { light: "#171717", dark: "#fafafa" };'
		);

		expect(output(/packages\/web\/app\/icon\.svg$/)).toMatch(
			/^<svg width="256" height="256" viewBox="0 0 20 20" fill="none" xmlns="http:\/\/www\.w3\.org\/2000\/svg"><style>svg\{color:#171717\}@media \(prefers-color-scheme:dark\)\{svg\{color:#fafafa\}\}<\/style>/
		);
		expect(output(/packages\/web\/public\/icon-light\.svg$/)).toContain(
			'color="#171717"'
		);
		expect(output(/packages\/web\/public\/icon-dark\.svg$/)).toContain(
			'color="#fafafa"'
		);
		expect(
			output(/packages\/ide\/overlay\/src\/browser\/media\/favicon\.svg$/)
		).toMatch(
			/^<svg width="100%" height="100%" viewBox="0 0 20 20".*<style>svg\{color:#171717\}/
		);
		expect(
			output(/packages\/ide\/overlay\/src\/browser\/media\/favicon-light\.svg$/)
		).toContain('<svg width="100%" height="100%"');
		expect(
			output(/packages\/ide\/overlay\/src\/browser\/media\/favicon-dark\.svg$/)
		).toContain('color="#fafafa"');

		expect(output(/packages\/mobile\/app\.json$/)).toBe(
			`${JSON.stringify(syncedApp, null, "\t")}\n`
		);
		expect(logs).toEqual([["Synced generated brand CSS and SVGs."]]);
	});

	test("leaves mobile splash configuration optional", async () => {
		host.app = {
			expo: {
				android: { adaptiveIcon: { backgroundColor: "#111111" } },
				plugins: ["unrelated"]
			}
		};

		await run();

		expect(JSON.parse(output(/packages\/mobile\/app\.json$/))).toEqual({
			expo: {
				android: { adaptiveIcon: { backgroundColor: "#0a0a0a" } },
				plugins: ["unrelated"]
			}
		});
	});

	test("refuses an ambiguous literal instead of silently changing one copy", async () => {
		host.app = structuredClone(app);
		const original = host.readiness;
		host.readiness = `${original}\n${original}`;
		try {
			await expect(run()).rejects.toThrow(
				"startup light: expected one palette literal, found 2"
			);
		} finally {
			host.readiness = original;
		}
	});

	test("names every ambiguous source literal in its failure", async () => {
		host.app = structuredClone(app);
		const originalReadiness = host.readiness;
		const cases = [
			{
				extra:
					"@media (prefers-color-scheme:dark){body{background:#999999;color:#aaaaaa",
				message: "startup dark: expected one palette literal, found 2"
			},
			{
				extra:
					'html[data-scheme="light"] body{background:#999999;color:#aaaaaa',
				message: "startup app light: expected one palette literal, found 2"
			},
			{
				extra: 'html[data-scheme="dark"] body{background:#999999;color:#aaaaaa',
				message: "startup app dark: expected one palette literal, found 2"
			}
		];
		try {
			for (const { extra, message } of cases) {
				host.readiness = `${originalReadiness}\n${extra}`;
				await expect(run()).rejects.toThrow(message);
			}
			host.readiness = originalReadiness;
			host.android = `${host.android}\n${host.android}`;
			await expect(run()).rejects.toThrow(
				"Android dialog accent: expected one palette literal, found 2"
			);
		} finally {
			host.readiness = originalReadiness;
		}
	});

	test("rejects a missing source literal before emitting a partial replacement", async () => {
		host.app = structuredClone(app);
		const original = host.readiness;
		host.readiness = original.replace("body{margin:0", "body{padding:0");
		try {
			await expect(run()).rejects.toThrow(
				"startup light: expected one palette literal, found 0"
			);
		} finally {
			host.readiness = original;
		}
	});

	test("check mode reports stale outputs without writing replacements", async () => {
		host.app = structuredClone(app);
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: number
		) => {
			throw new Error(`exit ${code}`);
		}) as never);
		const error = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		try {
			await expect(run(true)).rejects.toThrow("exit 1");
			expect(exit).toHaveBeenCalledWith(1);
			expect(error).toHaveBeenCalledWith(
				expect.stringMatching(
					/^Brand assets are stale - run `pnpm assets`:\n {2}packages/
				)
			);
			const message = error.mock.calls[0]?.[0] as string;
			expect(message.split("\n")).toHaveLength(12);
			expect(host.writes).toEqual([]);
		} finally {
			exit.mockRestore();
			error.mockRestore();
		}
	});

	test("check mode reports current outputs without writing replacements", async () => {
		host.app = structuredClone(app);
		await run();
		host.current = new Map(
			host.writes.map(({ path, contents }) => [slash(path), contents])
		);

		const logs = await run(true);

		expect(logs).toEqual([["Brand assets are up to date."]]);
		expect(host.writes).toEqual([]);
	});
});
