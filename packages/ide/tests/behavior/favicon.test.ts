// The one favicon script, driven against a real DOM. The whole point of it is
// that the tab icon changes without a reload, and only running the swap can show
// that: a grep for the file name passes just as happily on a script that sets
// the icon once and never again.
//
// The markup comes from the shipped pages and the shipped patch, not a copy, so a
// link that loses its scheme-pinned data attributes fails here. Every surface
// loads the same file, so the same script is driven against all three sets of
// links below.
import { type DOMWindow, JSDOM } from "jsdom";
import { afterEach, describe, expect, test } from "vitest";

import { BRAND_COLORS } from "../../../shared/index.ts";

import { readRepoFile } from "../../../../tests/support/repo.ts";
import { addedLines } from "../support/patch.ts";

const FAVICON_JS = readRepoFile(
	"packages/ide/overlay/src/browser/pages/favicon.js"
);

// Server-side template tokens ({{COMPOSERY_STATIC_BASE}}, {{BASE}}, ...) resolve
// to the deployment's static base; empty is the server-root case.
const untemplate = (html: string) => html.replaceAll(/{{[A-Z_]+}}/g, "");

const iconLinks = (html: string) =>
	untemplate(html).match(/<link\b[^>]*\brel="icon"[^>]*>/g) ?? [];

// The icon links exactly as the auth and error pages ship them.
const PAGES = ["auth.html", "error.html"] as const;
const pageIconLinks = (page: string) =>
	iconLinks(
		readRepoFile(`packages/ide/overlay/src/browser/pages/${page}`)
	).join("\n");

// The icon links exactly as workbench-page.diff adds them to the workbench.
const workbenchIconLinks = iconLinks(
	addedLines(readRepoFile("packages/ide/patches/workbench-page.diff"))
).join("\n");

type Harness = {
	window: DOMWindow;
	/** The href attribute the script last wrote, as written. */
	icon(): string | null;
	/** The OS/app colour scheme flipping under a live page. */
	setScheme(dark: boolean): void;
	/** One turn - long enough for a MutationObserver to deliver. */
	settle(): Promise<void>;
};

const harnesses: JSDOM[] = [];

afterEach(() => {
	for (const dom of harnesses.splice(0)) dom.window.close();
});

function start(
	body: string,
	links: string,
	script: string,
	{ dark = false } = {}
): Harness {
	const dom = new JSDOM(
		`<!doctype html><html><head>${links}</head><body>${body}</body></html>`,
		{ runScripts: "dangerously", url: "https://box.example/" }
	);
	harnesses.push(dom);
	const window = dom.window;

	// jsdom ships no matchMedia. This stands in for both the browser's and the
	// mobile app's shimmed one - same shape, same 'change' event.
	const listeners: ((event: { matches: boolean }) => void)[] = [];
	let schemeDark = dark;
	window.matchMedia = ((media: string) => ({
		media,
		onchange: null,
		get matches() {
			return /dark/.test(media) === schemeDark;
		},
		addEventListener: (type: string, callback: () => void) => {
			if (type === "change") listeners.push(callback);
		},
		removeEventListener: () => undefined,
		addListener: () => undefined,
		removeListener: () => undefined,
		dispatchEvent: () => false
	})) as unknown as typeof window.matchMedia;

	window.eval(script);

	return {
		window,
		icon: () =>
			window.document
				.querySelector("link[rel=icon][data-dark]")
				?.getAttribute("href") ?? null,
		setScheme: (next: boolean) => {
			schemeDark = next;
			for (const listener of listeners.slice()) listener({ matches: next });
		},
		settle: () => new Promise<void>((resolve) => setTimeout(resolve, 0))
	};
}

describe.each(PAGES)("%s favicon", (page) => {
	const links = pageIconLinks(page);

	test("pins the icon to the scheme already in effect", () => {
		const rendered = start("", links, FAVICON_JS, { dark: true });

		// The declared adaptive file is replaced on sight: it can only ever be
		// re-rasterized by a reload, which is the bug being fixed.
		expect(rendered.icon()).toBe("/src/browser/media/favicon-dark.svg");
	});

	test("follows a live scheme flip with no reload", () => {
		const rendered = start("", links, FAVICON_JS);
		expect(rendered.icon()).toBe("/src/browser/media/favicon-light.svg");

		rendered.setScheme(true);
		expect(rendered.icon()).toBe("/src/browser/media/favicon-dark.svg");

		rendered.setScheme(false);
		expect(rendered.icon()).toBe("/src/browser/media/favicon-light.svg");
	});
});

describe("workbench favicon", () => {
	const workbench = (classes: string) =>
		`<div class="monaco-workbench ${classes}"></div>`;

	test("follows the editor theme, not the OS scheme", async () => {
		// A dark editor on a light desktop: the tab belongs to what is on screen.
		const page = start(workbench("vs-dark"), workbenchIconLinks, FAVICON_JS);
		await page.settle();

		expect(page.icon()).toBe("/_static/src/browser/media/favicon-dark.svg");
	});

	test("follows a theme switch with no reload", async () => {
		const page = start(workbench("vs-dark"), workbenchIconLinks, FAVICON_JS);
		await page.settle();

		const element = page.window.document.querySelector(".monaco-workbench")!;
		element.className = "monaco-workbench vs";
		await page.settle();
		expect(page.icon()).toBe("/_static/src/browser/media/favicon-light.svg");

		element.className = "monaco-workbench hc-black";
		await page.settle();
		expect(page.icon()).toBe("/_static/src/browser/media/favicon-dark.svg");
	});

	test("uses the OS scheme until the workbench exists, then hands over", async () => {
		const page = start("", workbenchIconLinks, FAVICON_JS, {
			dark: true
		});
		expect(page.icon()).toBe("/_static/src/browser/media/favicon-dark.svg");

		// The workbench builds itself asynchronously, and its theme wins from the
		// moment it lands - a light editor under a dark desktop.
		page.window.document.body.innerHTML = workbench("vs");
		await page.settle();
		expect(page.icon()).toBe("/_static/src/browser/media/favicon-light.svg");
	});

	test("holds the icon while the workbench is still unthemed", async () => {
		const page = start("", workbenchIconLinks, FAVICON_JS, {
			dark: true
		});
		page.window.document.body.innerHTML = workbench("");
		await page.settle();

		// No theme class yet is a frame before the theme, not a light theme.
		expect(page.icon()).toBe("/_static/src/browser/media/favicon-dark.svg");
	});
});

describe("scheme-pinned favicon files", () => {
	// Both surfaces draw the same mark in the same two brand colours; the pinned
	// files exist so each URL renders one way, forever. A media query in one would
	// put us straight back to the icon that only updates on reload.
	test.each([
		"packages/ide/overlay/src/browser/media/favicon",
		"packages/web/public/icon"
	])("%s-light/-dark carry one fixed colour each", (base) => {
		const light = readRepoFile(`${base}-light.svg`);
		const dark = readRepoFile(`${base}-dark.svg`);

		expect(light).toContain(`color="${BRAND_COLORS.icon.light}"`);
		expect(dark).toContain(`color="${BRAND_COLORS.icon.dark}"`);
		expect(BRAND_COLORS.icon.light).not.toBe(BRAND_COLORS.icon.dark);
		for (const file of [light, dark]) {
			expect(file).not.toContain("prefers-color-scheme");
		}
	});

	// The website builds its <link> in JS, so nothing else ties those paths to
	// the files the generator writes: a rename on either side would leave the
	// tab icon quietly pointing at a 404.
	test("the website's theme sync points at files that exist", () => {
		const provider = readRepoFile("packages/web/components/theme-provider.tsx");
		const referenced = [
			...provider.matchAll(/"\/(icon-(?:light|dark)\.svg)"/g)
		].map((match) => match[1]);

		expect(referenced.sort()).toEqual(["icon-dark.svg", "icon-light.svg"]);
		for (const name of referenced) {
			expect(readRepoFile(`packages/web/public/${name}`)).toContain("<svg");
		}
	});
});
