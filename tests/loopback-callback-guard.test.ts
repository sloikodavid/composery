import { describe, expect, test } from "vitest";

import {
	evaluatePatchSnippets,
	extractAddedConst,
	extractAddedFunction,
	readRepoFile
} from "./support/patchSource.ts";

type Guard = {
	loopbackCallbackParamNames: Set<string>;
	normalizeLoopbackCallbackParamName(name: string): string;
	parseHttpUrl(value: string | null | undefined): URL | undefined;
	isLoopbackHost(hostname: string): boolean;
	findLoopbackCallbackTarget(url: URL, depth?: number): URL | undefined;
};

const trustedDomainsPatch = readRepoFile(
	"packages/ide/patches/loopback-callback.diff"
);
const functions = [
	"normalizeLoopbackCallbackParamName",
	"parseHttpUrl",
	"isLoopbackHost",
	"isIpv4MappedLoopbackHost",
	"getQueryLikeParams",
	"findLoopbackCallbackTarget"
];
const guard = evaluatePatchSnippets<Guard>(
	[
		extractAddedConst(trustedDomainsPatch, "loopbackCallbackParamNames"),
		...functions.map((name) => extractAddedFunction(trustedDomainsPatch, name))
	],
	["loopbackCallbackParamNames", ...functions]
);

function hasLoopbackCallbackTarget(href: string): boolean {
	const parsed = guard.parseHttpUrl(href);
	return (
		parsed !== undefined &&
		!guard.isLoopbackHost(parsed.hostname) &&
		guard.findLoopbackCallbackTarget(parsed) !== undefined
	);
}

describe("loopback callback guard", () => {
	test("normalizes callback parameter names", () => {
		expect(guard.normalizeLoopbackCallbackParamName(" redirect_uri ")).toBe(
			"redirecturi"
		);
		expect(guard.normalizeLoopbackCallbackParamName("RETURN-URL")).toBe(
			"returnurl"
		);
	});

	test("detects query, hash, and nested loopback callbacks", () => {
		expect(
			hasLoopbackCallbackTarget(
				"https://github.com/login/oauth/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fcallback"
			)
		).toBe(true);
		expect(
			hasLoopbackCallbackTarget(
				"https://identity.example/#/login?continue=http%3A%2F%2Fservice.localhost.%2Fdone"
			)
		).toBe(true);

		const nested =
			"https://one.example/cb?redirect_uri=" +
			encodeURIComponent(
				"https://two.example/cb?next=" +
					encodeURIComponent("http://127.0.0.1:5173/callback")
			);
		expect(hasLoopbackCallbackTarget(nested)).toBe(true);
	});

	test("bounds nested callback parsing", () => {
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
		expect(hasLoopbackCallbackTarget(tooDeep)).toBe(false);
	});

	test("does not warn for ordinary, top-level loopback, or non-http links", () => {
		expect(hasLoopbackCallbackTarget("https://example.com/docs")).toBe(false);
		expect(hasLoopbackCallbackTarget("http://127.0.0.1:3000/signin")).toBe(
			false
		);
		expect(
			hasLoopbackCallbackTarget(
				"https://example.com/cb?redirect_uri=vscode%3A%2F%2Fauth"
			)
		).toBe(false);
	});

	test("recognizes normalized loopback hosts without prefix false positives", () => {
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
		expect(guard.isLoopbackHost("127.example.com")).toBe(false);
	});

	test("routes Markdown HTTP links through the workbench decision point", () => {
		// The preview posts links to the workbench instead of deciding itself:
		// within the one patch, the guard logic lives only in the
		// trustedDomainsValidator sections, never the markdown extension's.
		const markdownSections = trustedDomainsPatch
			.split(/^--- /m)
			.filter((section) =>
				section.startsWith(
					"a/lib/vscode/extensions/markdown-language-features/"
				)
			);
		expect(markdownSections.length).toBeGreaterThan(0);
		const markdownPatch = markdownSections.join("\n");
		expect(markdownPatch).toContain("messaging.postMessage('openLink'");
		expect(markdownPatch).not.toContain("findLoopbackCallbackTarget");
		expect(trustedDomainsPatch).toContain(
			"private async promptForLoopbackCallbackLink"
		);

		const guardIndex = trustedDomainsPatch.indexOf(
			"+\t\tconst resourceUrl = parseHttpUrl"
		);
		const trustedWorkspaceIndex = trustedDomainsPatch.indexOf(
			"+\t\tif (openOptions?.fromWorkspace"
		);
		expect(trustedWorkspaceIndex).toBeGreaterThan(guardIndex);
	});
});
