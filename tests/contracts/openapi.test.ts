import { expect, test } from "bun:test";
import { createContractChecker } from "../../contracts/check";
import {
	type ContractSource,
	findOpenApiPath,
	type Schema,
	selectOpenApiDocument,
} from "../../contracts/openapi";

const selected = {
	source: "https://example.com/contract",
	holder: "paths",
	operations: { "/values": ["post"] },
} as const;

function toSource(document: Record<string, unknown>): ContractSource {
	return {
		source: selected.source,
		holder: "paths",
		readAt: "2026-09-21",
		digest: "example",
		document,
	};
}

function createChecker(
	schema: Schema,
	options: {
		version?: string;
		components?: unknown;
		parameters?: unknown;
	} = {},
) {
	return createContractChecker({
		system: "Example",
		waivers: [],
		contract: {
			sources: [
				toSource({
					openapi: options.version ?? "3.1.2",
					components: options.components,
					paths: {
						"/values": {
							post: {
								parameters: options.parameters,
								requestBody: {
									required: true,
									content: { "application/json": { schema } },
								},
								responses: {},
							},
						},
					},
				}),
			],
		},
	});
}

test("native selection keeps referenced schemas, recursive references, and every constraint", () => {
	const schema = {
		type: "object",
		required: ["name"],
		properties: {
			name: { type: "string", minLength: 2 },
			child: { $ref: "#/components/schemas/node" },
		},
	};
	const document = {
		openapi: "3.1.2",
		paths: {
			"/values": {
				post: {
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/node" },
							},
						},
					},
					responses: {},
				},
				get: { responses: {} },
			},
		},
		components: { schemas: { node: schema, unused: { type: "string" } } },
	};
	const retained = selectOpenApiDocument(document, selected);
	expect(retained.components).toEqual({ schemas: { node: schema } });
	expect(retained.paths).toEqual({
		"/values": { post: document.paths["/values"].post },
	});
	const checker = createContractChecker({
		system: "Example",
		contract: { sources: [toSource(retained)] },
		waivers: [],
	});
	expect(
		checker
			.listRequestProblems("POST", "/values", {
				name: "ok",
				child: { name: "x" },
			})
			.join(" "),
	).toContain("body.child.name");
	expect(
		checker.listRequestProblems("POST", "/values", {
			name: "ok",
			child: { name: "ok" },
		}),
	).toEqual([]);
	expect(document.components.schemas.node).toEqual(schema);
});

test("literal examples and property names do not become references", () => {
	const document = {
		openapi: "3.1.2",
		paths: {
			"/values": {
				post: {
					responses: {},
					requestBody: {
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										default: { $ref: "#/components/schemas/name" },
									},
									example: { $ref: "https://example.com/data" },
								},
							},
						},
					},
				},
			},
		},
		components: { schemas: { name: { type: "string" } } },
	};
	expect(selectOpenApiDocument(document, selected).components).toEqual(
		document.components,
	);
});

test("missing and external references fail instead of becoming unconstrained objects", () => {
	for (const $ref of [
		"#/components/schemas/Missing",
		"https://example.com/remote",
	]) {
		expect(() => createChecker({ $ref })).toThrow();
	}
});

test("the standard validator enforces constraints that the old subset omitted", () => {
	const cases: readonly [Schema, unknown, unknown][] = [
		[{ type: "string", minLength: 2, pattern: "^a" }, "ab", "x"],
		[
			{ type: "string", format: "date-time" },
			"2026-09-21T12:00:00Z",
			"yesterday",
		],
		[
			{
				type: "array",
				uniqueItems: true,
				minItems: 2,
				items: { type: "integer" },
			},
			[1, 2],
			[1, 1],
		],
		[{ type: "number", multipleOf: 2 }, 2, 1],
		[
			{ type: "object", dependentRequired: { name: ["id"] } },
			{ name: "one", id: 1 },
			{ name: "one" },
		],
		[
			{
				type: "object",
				properties: { id: { type: "integer" } },
				additionalProperties: false,
			},
			{ id: 1 },
			{ id: 1, extra: true },
		],
		[
			{
				type: "array",
				prefixItems: [{ type: "string" }],
				minItems: 1,
				items: false,
			},
			["one"],
			["one", 2],
		],
		[{ type: "object", enum: [{ id: 1 }] }, { id: 1 }, { id: 2 }],
	];
	for (const [schema, valid, invalid] of cases) {
		const checker = createChecker(schema);
		expect(checker.listRequestProblems("POST", "/values", valid)).toEqual([]);
		expect(
			checker.listRequestProblems("POST", "/values", invalid).length,
		).toBeGreaterThan(0);
	}
});

test("schemas are checked before data and validation never edits the data", () => {
	expect(() => createChecker({ type: "string", minLenght: 2 })).toThrow(
		"unknown keyword",
	);
	expect(() =>
		createChecker({ type: "string", format: "unpublished" }),
	).toThrow("unknown format");
	const checker = createChecker({
		type: "object",
		properties: { count: { type: "integer", default: 1 } },
	});
	const body = { count: "1" };
	expect(checker.listRequestProblems("POST", "/values", body)).toHaveLength(1);
	expect(body).toEqual({ count: "1" });
	const empty = {};
	checker.listRequestProblems("POST", "/values", empty);
	expect(empty).toEqual({});
});

test("OpenAPI 3.0 keeps nullable and boolean exclusive bounds", () => {
	const checker = createChecker(
		{ type: "number", nullable: true, minimum: 1, exclusiveMinimum: true },
		{ version: "3.0.3" },
	);
	expect(checker.listRequestProblems("POST", "/values", null)).toEqual([]);
	expect(checker.listRequestProblems("POST", "/values", 2)).toEqual([]);
	expect(checker.listRequestProblems("POST", "/values", 1)).toHaveLength(1);
});

test("OpenAPI 3.0 examples cannot supply schema identities", () => {
	const checker = createChecker(
		{
			type: "object",
			properties: {
				one: { type: "object", example: { id: "same", name: "one" } },
				two: { type: "object", example: { id: "same", name: "two" } },
			},
		},
		{ version: "3.0.3" },
	);
	expect(
		checker.listRequestProblems("POST", "/values", { one: {}, two: {} }),
	).toEqual([]);
});

test("reference siblings follow the OpenAPI version", () => {
	const schema = { $ref: "#/components/schemas/name", minLength: 2 };
	const components = { schemas: { name: { type: "string" } } };
	const older = createChecker(schema, { version: "3.0.3", components });
	const newer = createChecker(schema, { version: "3.1.2", components });
	expect(older.listRequestProblems("POST", "/values", "a")).toEqual([]);
	expect(newer.listRequestProblems("POST", "/values", "a")).toHaveLength(1);
});

test("unsupported directional properties fail inside newer schema keywords", () => {
	for (const schema of [
		{ prefixItems: [{ readOnly: true }], items: false, minItems: 1 },
		{ dependentSchemas: { name: { writeOnly: true } } },
		{ unevaluatedProperties: { readOnly: true } },
		{ unevaluatedItems: { readOnly: true } },
	]) {
		expect(() => createChecker(schema)).toThrow("Directional OpenAPI");
	}
});

test("query values keep question marks after the separator", () => {
	const checker = createChecker(
		{},
		{
			parameters: [
				{
					name: "value",
					in: "query",
					schema: { type: "string", enum: ["a?b"] },
				},
			],
		},
	);
	expect(checker.listRequestProblems("POST", "/values?value=a?b", {})).toEqual(
		[],
	);
});

test("query arrays follow form, space, and pipe serialization", () => {
	for (const [style, explode, value] of [
		["form", true, "items=1&items=2"],
		["form", false, "items=1,2"],
		["spaceDelimited", false, "items=1%202"],
		["pipeDelimited", false, "items=1|2"],
	] as const) {
		const checker = createChecker(
			{},
			{
				parameters: [
					{
						name: "items",
						in: "query",
						style,
						explode,
						schema: { type: "array", items: { type: "integer" } },
					},
				],
			},
		);
		expect(checker.listRequestProblems("POST", `/values?${value}`, {})).toEqual(
			[],
		);
		expect(
			checker.listRequestProblems("POST", "/values?items=bad", {}),
		).toHaveLength(1);
	}
});

test("static paths take precedence and empty path values do not match", () => {
	expect(findOpenApiPath(["user.created"], "user.created")).toBe(
		"user.created",
	);
	expect(
		findOpenApiPath(["/servers/{id}", "/servers/actions"], "/servers/actions"),
	).toBe("/servers/actions");
	expect(findOpenApiPath(["/servers/{id}"], "/servers/")).toBeUndefined();
});
