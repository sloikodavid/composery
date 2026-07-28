// Mobile consumes the shared web palette, but the native app and standalone
// colors editor cannot share rendered components. data-token is live editor
// metadata used for click-to-locate; deriving native property reads from the
// TypeScript AST pins that unavoidable external representation without keeping
// a hand-written second list of "mobile colors" that could drift.
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import ts from "typescript";
import { expect, test } from "vitest";

import { repoRoot } from "../support/repo.ts";

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
	});
}

function mobileThemeRoles(): Set<string> {
	const roles = new Set<string>();
	for (const path of sourceFiles(resolve(repoRoot, "packages/mobile/src"))) {
		const source = ts.createSourceFile(
			path,
			readFileSync(path, "utf8"),
			ts.ScriptTarget.Latest,
			true,
			path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
		);
		const visit = (node: ts.Node) => {
			if (
				ts.isPropertyAccessExpression(node) &&
				ts.isIdentifier(node.expression) &&
				node.expression.text === "theme"
			)
				roles.add(node.name.text);
			ts.forEachChild(node, visit);
		};
		visit(source);
	}
	return roles;
}

function previewRoles(): Set<string> {
	const document = new JSDOM(
		readFileSync(
			resolve(repoRoot, "packages/shared/tools/colors/index.html"),
			"utf8"
		)
	).window.document;
	const roots = [
		document.querySelector<HTMLTemplateElement>(
			'template[data-preview-shell="mobile"]'
		),
		...document.querySelectorAll<HTMLTemplateElement>(
			'template[data-preview-state][data-surface="mobile"]'
		)
	];
	const roles = new Set<string>();
	for (const root of roots) {
		if (!root) throw new Error("missing mobile preview shell");
		for (const element of root.content.querySelectorAll<HTMLElement>(
			"[data-token]"
		))
			for (const token of element.dataset.token!.split(/\s+/))
				if (token.startsWith("web.")) roles.add(token.slice(4));
	}
	return roles;
}

test("native preview roles equal the shared colors the mobile app reads", () => {
	expect([...previewRoles()].sort()).toEqual([...mobileThemeRoles()].sort());
});
