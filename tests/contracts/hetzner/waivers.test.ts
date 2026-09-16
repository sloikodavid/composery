import { expect, test } from "bun:test";
import { createContractChecker, readContract } from "../../../contracts/check";
import { createHetznerContractChecker } from "../../../contracts/hetzner/check";
import { hetznerSelection } from "../../../contracts/hetzner/selection";
import { hetznerWaivers } from "../../../contracts/hetzner/waivers";

/**
 * Every waiver must still be needed. A run of part of the suite cannot prove that, so each waiver
 * carries a reproducer here: the exact value that makes Hetzner's description refuse what Hetzner
 * itself accepts. Adding a waiver without one fails this file.
 */

const contractUrl = new URL(
	"../../../contracts/hetzner/check.ts",
	import.meta.url,
).href;

/** What Composery sends when it creates a server, with the parts a waiver is about. */
const createServerBody = {
	name: "one",
	image: 501,
	// biome-ignore lint/style/useNamingConvention: the Hetzner Cloud API names this field
	server_type: "cx23",
	location: "nbg1",
};

const reproducers: Record<string, () => string[]> = {
	"POST /servers body.image": () =>
		listUnwaivedProblems("POST", "servers", createServerBody),
};

/** The same request, read by a checker that holds no waivers at all. */
function listUnwaivedProblems(method: string, path: string, body: unknown) {
	return createContractChecker({
		system: hetznerSelection.system,
		contract: readContract(contractUrl),
		waivers: [],
	}).listRequestProblems(method, path, body);
}

test("every waiver has a reproducer, and every reproducer has a waiver", () => {
	const named = hetznerWaivers.map(
		(waiver) => `${waiver.operation} ${waiver.at}`,
	);
	expect([...named].sort()).toEqual(Object.keys(reproducers).sort());
});

test("every waiver still describes a real difference, and hides nothing else", () => {
	for (const waiver of hetznerWaivers) {
		const place = `${waiver.operation} ${waiver.at}`;
		// Without the waiver, Hetzner's description refuses what Hetzner accepts.
		expect(reproducers[place]?.().join("\n")).toContain(place);
		// With it, the same request raises nothing, and no other difference is swallowed.
		const checker = createHetznerContractChecker();
		expect(
			checker.listRequestProblems("POST", "servers", createServerBody),
		).toEqual([]);
	}
});

test("a waiver does not excuse a neighbouring field", () => {
	const checker = createHetznerContractChecker();
	expect(
		checker
			.listRequestProblems("POST", "servers", {
				...createServerBody,
				name: 7,
			})
			.join("\n"),
	).toContain("POST /servers body.name is 7, not string");
});
