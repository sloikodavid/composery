import { expect, test } from "bun:test";
import type { ContractProblem } from "../../contracts/schema";
import {
	findWaiver,
	listStaleWaiverProblems,
	toWaiverKey,
	type Waiver,
} from "../../contracts/waiver";

const waivers: readonly Waiver[] = [
	{
		operation: "POST /servers",
		at: "body.image",
		claims: "string",
		reason: "Hetzner reads an ID here as well as a name",
		evidence: "Hetzner's own client sends a number",
	},
];

function toProblem(fields: Partial<ContractProblem> = {}): ContractProblem {
	return {
		operation: "POST /servers",
		at: "body.image",
		claims: "string",
		message: "is 501, not string",
		...fields,
	};
}

test("a waiver is found for the one place it names, and nothing else", () => {
	expect(findWaiver(waivers, toProblem())).toBeDefined();
	expect(
		findWaiver(waivers, toProblem({ at: "body.image_type" })),
	).toBeUndefined();
	expect(
		findWaiver(waivers, toProblem({ operation: "POST /primary_ips" })),
	).toBeUndefined();
});

test("a waiver whose operation ran without disagreeing is stale", () => {
	expect(
		listStaleWaiverProblems({
			waivers,
			system: "Hetzner",
			used: new Set(),
			ranOperations: new Set(["POST /servers"]),
		}).join("\n"),
	).toContain("is stale");
});

test("a waiver that was used, or whose operation did not run, is not stale", () => {
	const key = toWaiverKey({ operation: "POST /servers", at: "body.image" });
	expect(
		listStaleWaiverProblems({
			waivers,
			system: "Hetzner",
			used: new Set([key]),
			ranOperations: new Set(["POST /servers"]),
		}),
	).toEqual([]);
	expect(
		listStaleWaiverProblems({
			waivers,
			system: "Hetzner",
			used: new Set(),
			ranOperations: new Set(["GET /servers"]),
		}),
	).toEqual([]);
});
