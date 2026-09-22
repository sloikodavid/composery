import { expect, test } from "bun:test";
import { createContractChecker, readContract } from "../../contracts/check";
import {
	createHetznerContractChecker,
	hetznerWaivers,
} from "../../contracts/hetzner";

const contractUrl = new URL("../../contracts/hetzner.ts", import.meta.url).href;
const notFound = 404;
const forbidden = 403;

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
		annotationFormats: ["decimal"],
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
	).toContain("POST /servers body.name must be string");
});

test("the image waiver refuses values outside positive integer IDs", () => {
	const checker = createHetznerContractChecker();
	const nonIntegerId = 1.5;
	for (const image of [false, {}, 0, -1, nonIntegerId]) {
		expect(
			checker
				.listRequestProblems("POST", "servers", { ...createServerBody, image })
				.join(" "),
		).toContain("body.image");
	}
});

test("Hetzner's published lower-case status ranges still validate error bodies", () => {
	const checker = createHetznerContractChecker();
	for (const [method, path, status] of [
		["GET", "/servers/1", notFound],
		["GET", "/primary_ips/1", notFound],
		["POST", "/servers", forbidden],
	] as const) {
		expect(
			checker.listReplyProblems(method, path, status, {
				error: { code: "not_found", message: "Not found" },
			}),
		).toEqual([]);
		expect(checker.listReplyProblems(method, path, status, {})).toHaveLength(1);
	}
});
