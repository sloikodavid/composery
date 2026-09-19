import { expect, test } from "bun:test";
import { createContractChecker, readContract } from "../../contracts/check";
import {
	createHetznerContractChecker,
	hetznerWaivers,
} from "../../contracts/hetzner";

const contractUrl = new URL("../../contracts/hetzner.ts", import.meta.url).href;

// Every waiver needs a reproducer and must not hide a second difference.

const createServerBody = {
	name: "one",
	image: 501,
	// biome-ignore lint/style/useNamingConvention: external field name
	server_type: "cx23",
	location: "nbg1",
};

const reproducers: Record<string, () => string[]> = {
	"POST /servers body.image": () =>
		listUnwaivedProblems("POST", "servers", createServerBody),
};

function listUnwaivedProblems(method: string, path: string, body: unknown) {
	return createContractChecker({
		system: "Hetzner",
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
		expect(reproducers[place]?.().join("\n")).toContain(place);
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
