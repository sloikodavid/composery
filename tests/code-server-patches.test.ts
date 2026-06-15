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

describe("code-server patch stack", () => {
	test("keeps loopback callback parameter names aligned across copied runtime patches", () => {
		const markdownPatch = readRepoFile(
			"vendor/code-server/patches/markdown-preview-loopback-callback-bridge.diff"
		);
		const trustedDomainsPatch = readRepoFile(
			"vendor/code-server/patches/trusted-domains-loopback-callback-guard.diff"
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
			"vendor/code-server/patches/markdown-preview-loopback-callback-bridge.diff"
		);
		const trustedDomainsPatch = readRepoFile(
			"vendor/code-server/patches/trusted-domains-loopback-callback-guard.diff"
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
			"vendor/code-server/patches/trusted-domains-loopback-callback-guard.diff"
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
			"vendor/code-server/patches/markdown-preview-loopback-callback-bridge.diff"
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
		"vendor/code-server/overlay/lib/vscode/extensions/composery-agents/extension.js"
	);
	const welcome = readRepoFile("vendor/code-server/patches/welcome.diff");

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
				`vendor/code-server/overlay/src/browser/media/agents/${id}.svg`
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
