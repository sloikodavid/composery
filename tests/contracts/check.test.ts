import { expect, test } from "bun:test";
import { createContractChecker } from "../../contracts/check";
import type { Contract } from "../../contracts/schema";

const created = 201;
const ok = 200;

const contract: Contract = {
	sources: [
		{ source: "https://example.com/spec.json", readAt: "", digest: "" },
	],
	paths: {
		"/servers": {
			post: {
				parameters: [],
				request: {
					type: "object",
					required: ["name"],
					properties: { name: { type: "string" } },
				},
				responses: {
					"201": {
						type: "object",
						required: ["server"],
						properties: {
							server: {
								type: "object",
								required: ["id"],
								properties: { id: { type: "integer" } },
							},
						},
					},
				},
			},
		},
		"/servers/{id}": {
			get: {
				parameters: [{ name: "detail", in: "query", required: false }],
				request: {},
				responses: { "200": { type: "object" } },
			},
		},
	},
};

function createChecker() {
	return createContractChecker({ system: "Example", contract, waivers: [] });
}

test("a request the description does not cover is a problem in itself", () => {
	const checker = createChecker();
	expect(checker.listRequestProblems("GET", "volumes", undefined)).toEqual([
		"Example does not describe GET volumes",
	]);
	expect(checker.listRequestProblems("DELETE", "servers/1", undefined)).toEqual(
		["Example does not describe DELETE /servers/{id}"],
	);
});

test("a request is read against the description of the path it matches", () => {
	const checker = createChecker();
	expect(
		checker.listRequestProblems("POST", "servers", { name: "one" }),
	).toEqual([]);
	expect(checker.listRequestProblems("POST", "servers", { name: 1 })).toEqual([
		"POST /servers body.name is 1, not string",
	]);
	expect(
		checker.listRequestProblems(
			"GET",
			"servers/1?detail=full&colour=red",
			undefined,
		),
	).toEqual([
		"GET /servers/{id} query.colour is asked for, and Example does not read it",
	]);
});

test("a reply is read against the description of that status", () => {
	const checker = createChecker();
	expect(
		checker.listReplyProblems("POST", "servers", created, {
			server: { id: 1 },
		}),
	).toEqual([]);
	expect(checker.listReplyProblems("POST", "servers", created, {})).toEqual([
		"POST /servers 201.server is missing, and Example always sends it",
	]);
	expect(checker.listReplyProblems("POST", "servers", ok, {})).toEqual([
		"Example does not describe a 200 for POST /servers",
	]);
});

test("the checker keeps what it found, so a later reader sees every problem", () => {
	const checker = createChecker();
	checker.listRequestProblems("POST", "servers", { name: 1 });
	checker.listReplyProblems("POST", "servers", created, {});
	checker.noteProblem("something else was wrong");
	expect(checker.listProblems()).toEqual([
		"POST /servers body.name is 1, not string",
		"POST /servers 201.server is missing, and Example always sends it",
		"something else was wrong",
	]);
});

test("a waiver takes one problem out, and says so when it stops being needed", () => {
	const waivers = [
		{
			operation: "POST /servers",
			at: "body.name",
			claims: "string",
			reason: "the system reads a number here too",
			evidence: "a run against the real system",
		},
	];
	const waived = createContractChecker({
		system: "Example",
		contract,
		waivers,
	});
	expect(waived.listRequestProblems("POST", "servers", { name: 1 })).toEqual(
		[],
	);
	expect(waived.listProblems()).toEqual([]);

	const unused = createContractChecker({
		system: "Example",
		contract,
		waivers,
	});
	unused.listRequestProblems("POST", "servers", { name: "one" });
	expect(unused.listProblems().join("\n")).toContain("is stale");
});
