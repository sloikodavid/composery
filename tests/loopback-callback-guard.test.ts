import { describe, expect, test } from "vitest";

import {
	evaluatePatchSnippets,
	extractAddedConst,
	extractAddedFunction,
	readRepoFile
} from "./support/patchSource.ts";

// Both patches ship their own copy of the guard (they run in isolated contexts:
// the Markdown preview iframe and the workbench). These tests execute the code
// each patch actually adds, so the copies cannot drift apart unnoticed.

type Guard = {
	loopbackCallbackParamNames: Set<string>;
	normalizeLoopbackCallbackParamName(name: string): string;
	parseHttpUrl(value: string | null | undefined): URL | undefined;
	isLoopbackHost(hostname: string): boolean;
	findLoopbackCallbackTarget(url: URL, depth?: number): URL | undefined;
	shouldDelegateLoopbackCallbackLinkToVsCode?(href: string | null): boolean;
};

const guardFunctions = [
	"normalizeLoopbackCallbackParamName",
	"parseHttpUrl",
	"isLoopbackHost",
	"isIpv4MappedLoopbackHost",
	"getQueryLikeParams",
	"findLoopbackCallbackTarget"
];

function loadGuard(patchPath: string, extraFunctions: string[] = []): Guard {
	const patch = readRepoFile(patchPath);
	const names = [...guardFunctions, ...extraFunctions];
	return evaluatePatchSnippets<Guard>(
		[
			extractAddedConst(patch, "loopbackCallbackParamNames"),
			...names.map((name) => extractAddedFunction(patch, name))
		],
		["loopbackCallbackParamNames", ...names]
	);
}

const markdown = loadGuard(
	"packages/ide/patches/markdown-preview-loopback-callback-bridge.diff",
	["shouldDelegateLoopbackCallbackLinkToVsCode"]
);
const trustedDomains = loadGuard(
	"packages/ide/patches/trusted-domains-loopback-callback-guard.diff"
);

// The guard verdict for a link: external http(s) URL carrying a loopback
// callback in its (possibly hash-shaped) query. Markdown exposes this as
// shouldDelegateLoopbackCallbackLinkToVsCode; trusted domains wires the same
// primitives inside promptForLoopbackCallbackLink.
function hasLoopbackCallbackTarget(guard: Guard, href: string): boolean {
	if (guard.shouldDelegateLoopbackCallbackLinkToVsCode) {
		return guard.shouldDelegateLoopbackCallbackLinkToVsCode(href);
	}
	const parsed = guard.parseHttpUrl(href);
	return (
		parsed !== undefined &&
		!guard.isLoopbackHost(parsed.hostname) &&
		guard.findLoopbackCallbackTarget(parsed) !== undefined
	);
}

describe.each([
	["markdown preview bridge", markdown],
	["trusted domains guard", trustedDomains]
])("loopback callback guard (%s)", (_label, guard) => {
	test("normalizes callback parameter names across common spellings", () => {
		expect(guard.normalizeLoopbackCallbackParamName(" redirect_uri ")).toBe(
			"redirecturi"
		);
		expect(guard.normalizeLoopbackCallbackParamName("RETURN-URL")).toBe(
			"returnurl"
		);
		expect(guard.normalizeLoopbackCallbackParamName("target.link.uri")).toBe(
			"targetlinkuri"
		);
	});

	test("detects explicit loopback callback targets in query parameters", () => {
		expect(
			hasLoopbackCallbackTarget(
				guard,
				"https://github.com/login/oauth/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fcallback"
			)
		).toBe(true);

		const parsed = guard.parseHttpUrl(
			"https://example.com/start?return-to=http%3A%2F%2Flocalhost.%2Fdone"
		);

		expect(parsed).toBeDefined();
		expect(guard.findLoopbackCallbackTarget(parsed!)?.origin).toBe(
			"http://localhost."
		);
	});

	test("detects loopback callback targets in hash query shapes", () => {
		expect(
			hasLoopbackCallbackTarget(
				guard,
				"https://identity.example/#/login?continue=http%3A%2F%2Fservice.localhost.%2Fdone"
			)
		).toBe(true);

		expect(
			hasLoopbackCallbackTarget(
				guard,
				"https://identity.example/#next=http%3A%2F%2F%5B%3A%3A1%5D%3A4444%2Fdone"
			)
		).toBe(true);
	});

	test("detects nested callback targets with a bounded recursion depth", () => {
		const nestedOnce =
			"https://one.example/cb?redirect_uri=" +
			encodeURIComponent(
				"https://two.example/cb?next=" +
					encodeURIComponent("http://127.0.0.1:5173/callback")
			);

		expect(hasLoopbackCallbackTarget(guard, nestedOnce)).toBe(true);

		const tooDeep =
			"https://one.example/cb?redirect_uri=" +
			encodeURIComponent(
				"https://two.example/cb?redirect_uri=" +
					encodeURIComponent(
						"https://three.example/cb?redirect_uri=" +
							encodeURIComponent(
								"https://four.example/cb?redirect_uri=" +
									encodeURIComponent("http://127.0.0.1:5173/callback")
							)
					)
			);

		expect(hasLoopbackCallbackTarget(guard, tooDeep)).toBe(false);
	});

	test("does not warn for ordinary external links or top-level loopback links", () => {
		expect(hasLoopbackCallbackTarget(guard, "https://example.com/docs")).toBe(
			false
		);
		expect(
			hasLoopbackCallbackTarget(
				guard,
				"https://example.com/cb?redirect_uri=https%3A%2F%2Fapp.example%2Fdone"
			)
		).toBe(false);
		expect(
			hasLoopbackCallbackTarget(guard, "http://127.0.0.1:3000/signin")
		).toBe(false);
		expect(
			hasLoopbackCallbackTarget(
				guard,
				"https://example.com/cb?redirect_uri=vscode%3A%2F%2Fauth"
			)
		).toBe(false);
	});

	test("recognizes loopback host variants that URL parsing normalizes", () => {
		expect(guard.isLoopbackHost(new URL("http://0177.0.0.1/").hostname)).toBe(
			true
		);
		expect(guard.isLoopbackHost(new URL("http://2130706433/").hostname)).toBe(
			true
		);
		expect(
			guard.isLoopbackHost(new URL("http://foo.localhost./").hostname)
		).toBe(true);
		expect(
			guard.isLoopbackHost(new URL("http://[::ffff:127.0.0.1]/").hostname)
		).toBe(true);
		expect(guard.isLoopbackHost("example.com")).toBe(false);
	});
});

describe("loopback callback guard (cross-patch)", () => {
	test("both patches recognize the same callback parameter names", () => {
		expect([...markdown.loopbackCallbackParamNames].sort()).toEqual(
			[...trustedDomains.loopbackCallbackParamNames].sort()
		);
	});

	test("keeps Markdown preview as a bridge and trusted domains as the decision point", () => {
		const markdownPatch = readRepoFile(
			"packages/ide/patches/markdown-preview-loopback-callback-bridge.diff"
		);
		const trustedDomainsPatch = readRepoFile(
			"packages/ide/patches/trusted-domains-loopback-callback-guard.diff"
		);

		expect(markdownPatch).not.toContain("hasSuspiciousLoopbackCallback");
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
