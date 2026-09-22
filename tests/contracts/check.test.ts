import { expect, test } from "bun:test";
import { createContractChecker, type Waiver } from "../../contracts/check";
import type { Contract, Schema } from "../../contracts/openapi";

const created = 201;
const noContent = 204;
const tooManyRequests = 429;
const serverError = 500;
const nonInteger = 1.5;

function createContract(
	schema: Schema = {
		type: "object",
		required: ["name"],
		properties: { name: { type: "string" } },
	},
): Contract {
	return {
		sources: [
			{
				source: "https://example.com/contract",
				readAt: "2026-09-21",
				digest: "example",
				holder: "paths",
				document: {
					openapi: "3.1.2",
					paths: {
						"/servers": {
							post: {
								requestBody: {
									required: true,
									content: { "application/json": { schema } },
								},
								responses: {
									"201": {
										content: {
											"application/json": {
												schema: {
													type: "object",
													required: ["id"],
													properties: { id: { type: "integer" } },
												},
											},
										},
									},
									"204": { description: "No body" },
									"4XX": {
										content: {
											"application/json": { schema: { type: "string" } },
										},
									},
									default: {
										content: {
											"application/json": { schema: { type: "boolean" } },
										},
									},
								},
							},
						},
						"/servers/{id}": {
							get: {
								parameters: [
									{
										name: "id",
										in: "path",
										required: true,
										schema: { type: "integer", minimum: 1 },
									},
									{
										name: "page",
										in: "query",
										required: true,
										schema: { type: "integer", minimum: 1 },
									},
								],
								responses: {},
							},
						},
					},
				},
			},
		],
	};
}

function createChecker(
	contract = createContract(),
	waivers: readonly Waiver[] = [],
) {
	return createContractChecker({ system: "Example", contract, waivers });
}

test("required, absent, and empty request bodies stay distinct", () => {
	const checker = createChecker();
	expect(checker.listRequestProblems("POST", "/servers", undefined)).toEqual([
		"POST /servers body is required",
	]);
	expect(checker.listRequestProblems("POST", "/servers", {})).toEqual([
		"POST /servers body.name must have required property 'name'",
	]);
	expect(
		checker.listRequestProblems("POST", "/servers", { name: "one" }),
	).toEqual([]);
	expect(checker.listRequestProblems("GET", "/servers/1?page=1", {})).toEqual([
		"GET /servers/{id} body has no described body",
	]);
});

test("path values, query values, missing parameters, and unknown operations are checked", () => {
	const checker = createChecker();
	expect(
		checker.listRequestProblems("GET", "servers/1?page=1", undefined),
	).toEqual([]);
	expect(
		checker
			.listRequestProblems("GET", "/servers/no?page=0&extra=1", undefined)
			.map((problem) => problem.split(" ")[2]),
	).toEqual(["query.extra", "path.id", "query.page"]);
	expect(checker.listRequestProblems("GET", "/servers/1", undefined)).toEqual([
		"GET /servers/{id} query.page is required",
	]);
	expect(checker.listRequestProblems("GET", "/unknown", undefined)).toEqual([
		"Example does not describe GET /unknown",
	]);
	expect(
		checker.listRequestProblems("DELETE", "/servers/1", undefined),
	).toEqual(["Example does not describe DELETE /servers/{id}"]);
});

test("reply bodies use the exact status before a range or default", () => {
	const checker = createChecker();
	expect(
		checker.listReplyProblems("POST", "/servers", created, { id: 1 }),
	).toEqual([]);
	expect(
		checker.listReplyProblems("POST", "/servers", created, undefined),
	).toEqual(["POST /servers 201 is required"]);
	expect(
		checker.listReplyProblems("POST", "/servers", noContent, undefined),
	).toEqual([]);
	expect(
		checker.listReplyProblems("POST", "/servers", noContent, {}),
	).toHaveLength(1);
	expect(
		checker.listReplyProblems("POST", "/servers", tooManyRequests, "later"),
	).toEqual([]);
	expect(
		checker.listReplyProblems("POST", "/servers", serverError, false),
	).toEqual([]);
});

test("the checker keeps failures without including request secrets in messages", () => {
	const checker = createChecker();
	const problems = checker.listRequestProblems("POST", "/servers", {
		name: { secret: "do-not-print" },
	});
	checker.noteProblem("another failure");
	expect(checker.listProblems()).toEqual([...problems, "another failure"]);
	expect(checker.listProblems().join(" ")).not.toContain("do-not-print");
});

const waiver: Waiver = {
	operation: "POST /servers",
	at: "body.name",
	keyword: "type",
	claims: '"string"',
	accepts: (value) =>
		typeof value === "number" && Number.isSafeInteger(value) && value > 0,
	reason: "The example system also accepts an integer ID.",
	evidence: "An example exchange.",
};

test("a waiver permits only its keyword and evidenced values", () => {
	const checker = createChecker(createContract(), [waiver]);
	expect(checker.listRequestProblems("POST", "/servers", { name: 1 })).toEqual(
		[],
	);
	expect(checker.listProblems()).toEqual([]);
	for (const name of [false, {}, -1, nonInteger]) {
		expect(
			checker.listRequestProblems("POST", "/servers", { name }),
		).toHaveLength(1);
	}
	const pattern = createChecker(
		createContract({
			type: "object",
			properties: { name: { type: "string", pattern: "^a" } },
		}),
		[waiver],
	);
	expect(
		pattern.listRequestProblems("POST", "/servers", { name: "wrong" }),
	).toHaveLength(1);
});

test("a changed claim and an unused waiver both fail", () => {
	const changed = createChecker(
		createContract({
			type: "object",
			properties: { name: { type: "boolean" } },
		}),
		[waiver],
	);
	expect(
		changed.listRequestProblems("POST", "/servers", { name: 1 }).join(" "),
	).toContain("has changed");
	const stale = createChecker(createContract(), [waiver]);
	expect(stale.listProblems()).toEqual([]);
	stale.listRequestProblems("POST", "/servers", { name: "one" });
	expect(stale.listProblems().join(" ")).toContain("is stale");
});

test("a duplicate waiver or operation is rejected before traffic", () => {
	expect(() => createChecker(createContract(), [waiver, waiver])).toThrow(
		"repeated",
	);
	const contract = createContract();
	expect(() =>
		createChecker({ sources: [...contract.sources, ...contract.sources] }),
	).toThrow("repeats");
});
