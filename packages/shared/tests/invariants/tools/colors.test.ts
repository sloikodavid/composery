// The colors editor is a standalone browser artifact, while theme.json is the
// canonical source consumed by its server. The preview cannot import that JSON
// at build time without creating the second copy the editor exists to avoid.
// Its runtime data-token metadata also drives click-to-locate, so reading the
// rendered template DOM here pins the unavoidable external representation to
// the canonical roles without separately listing them.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, test } from "vitest";

const sharedRoot = resolve(import.meta.dirname, "../../..");
const theme = JSON.parse(
	readFileSync(resolve(sharedRoot, "theme.json"), "utf8")
) as Record<"web" | "ide", Record<"light" | "dark", Record<string, string>>>;
const document = new JSDOM(
	readFileSync(resolve(sharedRoot, "tools/colors/index.html"), "utf8")
).window.document;

function tokensIn(root: ParentNode): Set<string> {
	return new Set(
		[...root.querySelectorAll<HTMLElement>("[data-token]")]
			.flatMap((element) => element.dataset.token!.split(/\s+/))
			.filter(Boolean)
	);
}

function surfaceTokens(surface: string): Set<string> {
	const shell = document.querySelector<HTMLTemplateElement>(
		`template[data-preview-shell="${surface}"]`
	);
	if (!shell) throw new Error(`missing ${surface} preview shell`);
	const tokens = tokensIn(shell.content);
	for (const state of document.querySelectorAll<HTMLTemplateElement>(
		`template[data-preview-state][data-surface="${surface}"]`
	))
		for (const token of tokensIn(state.content)) tokens.add(token);
	return tokens;
}

describe("colors preview metadata", () => {
	test.each(["web", "ide", "mobile"])(
		"%s exposes uniquely named switchable reference states",
		(surface) => {
			const states = [
				...document.querySelectorAll<HTMLTemplateElement>(
					`template[data-preview-state][data-surface="${surface}"]`
				)
			];
			const views = states.map((state) => state.dataset.view);
			const labels = states.map((state) => state.dataset.label);

			expect(states.length).toBeGreaterThan(1);
			expect(views.every(Boolean)).toBe(true);
			expect(labels.every(Boolean)).toBe(true);
			expect(new Set(views).size).toBe(views.length);
			expect(new Set(labels).size).toBe(labels.length);
		}
	);

	test.each(["web", "ide"] as const)(
		"%s gives every editable role a visible preview destination",
		(surface) => {
			const prefixed = [...surfaceTokens(surface)]
				.filter((token) => token.startsWith(`${surface}.`))
				.map((token) => token.slice(surface.length + 1))
				.sort();

			expect(prefixed).toEqual(Object.keys(theme[surface].light).sort());
		}
	);

	test("IDE shared roles are exactly the statuses generated into the workbench", () => {
		const shared = [...surfaceTokens("ide")]
			.filter((token) => token.startsWith("web."))
			.sort();

		expect(shared).toEqual(
			["destructive", "info", "success", "warning"]
				.map((role) => `web.${role}`)
				.sort()
		);
	});

	test("every preview token names a canonical editable role", () => {
		const canonical = new Set(
			Object.entries(theme).flatMap(([surface, schemes]) =>
				Object.keys(schemes.light).map((role) => `${surface}.${role}`)
			)
		);
		const referenced = new Set(
			["web", "ide", "mobile"].flatMap((surface) => [...surfaceTokens(surface)])
		);

		expect([...referenced].filter((token) => !canonical.has(token))).toEqual(
			[]
		);
	});
});
