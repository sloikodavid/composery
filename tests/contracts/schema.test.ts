import { expect, test } from "bun:test";
import {
	findPathTemplate,
	listMissingQueryProblems,
	listQueryValueProblems,
	listSchemaProblems,
	listUnreadFieldProblems,
	listUnreadQueryProblems,
	type Schema,
} from "../../contracts/schema";

const server: Schema = {
	type: "object",
	required: ["id", "status", "addresses"],
	properties: {
		id: { type: "integer" },
		status: { type: "string", enum: ["running", "off"] },
		name: { type: ["string", "null"] },
		addresses: { type: "array", items: { type: "string" } },
	},
};

const subject = { system: "Hetzner", operation: "GET /servers" };
const nonIntegerNumber = 1.5;

function toMessages(value: unknown) {
	return listSchemaProblems(subject, server, value, "200").map(
		(problem) => `${problem.at} ${problem.message}`,
	);
}

test("a value the description allows raises nothing", () => {
	expect(
		toMessages({
			id: 7,
			status: "off",
			name: null,
			addresses: ["203.0.113.1"],
		}),
	).toEqual([]);
});

test("a field the system always sends is missed when it is absent", () => {
	expect(toMessages({ id: 7, addresses: [] })).toEqual([
		"200.status is missing, and Hetzner always sends it",
	]);
});

test("a type the description does not give is refused, inside an array too", () => {
	expect(toMessages({ id: "7", status: "off", addresses: [] })).toEqual([
		'200.id is "7", not integer',
	]);
	expect(toMessages({ id: 7, status: "off", addresses: [1] })).toEqual([
		"200.addresses[0] is 1, not string",
	]);
});

test("a value outside the list the system sends is refused", () => {
	expect(toMessages({ id: 7, status: "melting", addresses: [] })).toEqual([
		'200.status is "melting", which Hetzner never sends',
	]);
});

test("a map validates values for fields not listed by name", () => {
	const labels: Schema = {
		type: "object",
		additionalProperties: { type: "string" },
	};
	expect(listSchemaProblems(subject, labels, { owner: "one" }, "200")).toEqual(
		[],
	);
	expect(
		listSchemaProblems(subject, labels, { owner: 1 }, "200").map(
			(problem) => `${problem.at} ${problem.message}`,
		),
	).toEqual(["200.owner is 1, not string"]);
});

test("a strict object refuses a field the description does not allow", () => {
	const strict: Schema = {
		type: "object",
		properties: { id: { type: "integer" } },
		additionalProperties: false,
	};
	expect(
		listSchemaProblems(subject, strict, { id: 1, colour: "red" }, "200").map(
			(problem) => `${problem.at} ${problem.message}`,
		),
	).toEqual(["200.colour is sent, and Hetzner does not describe it"]);
});

test("a field the description never reads is reported, and a known one is not", () => {
	const problems = listUnreadFieldProblems(
		{ system: "Hetzner", operation: "POST /servers" },
		server,
		{ id: 7, colour: "red" },
	);
	expect(problems.map((problem) => problem.at)).toEqual(["body.colour"]);
});

test("a query the description never reads is reported", () => {
	const parameters = [{ name: "name", in: "query", required: false }];
	const problems = listUnreadQueryProblems(
		subject,
		parameters,
		new URLSearchParams("name=one&colour=red"),
	);
	expect(problems.map((problem) => problem.at)).toEqual(["query.colour"]);
});

test("a required query value cannot be omitted", () => {
	const parameters = [{ name: "page", in: "query", required: true }];
	const problems = listMissingQueryProblems(
		subject,
		parameters,
		new URLSearchParams(),
	);
	expect(problems.map((problem) => `${problem.at} ${problem.message}`)).toEqual(
		["query.page is missing, and Hetzner requires it"],
	);
});

test("a path with an identifier in it finds the template that describes it", () => {
	const templates = [
		"/servers",
		"/servers/{id}",
		"/servers/{id}/actions/poweron",
	];
	expect(findPathTemplate(templates, "servers/1005")).toBe("/servers/{id}");
	expect(findPathTemplate(templates, "servers?name=one")).toBe("/servers");
	expect(findPathTemplate(templates, "servers/1005/actions/poweron")).toBe(
		"/servers/{id}/actions/poweron",
	);
	expect(findPathTemplate(templates, "volumes/1")).toBeUndefined();
	expect(
		findPathTemplate(["/servers/{id}", "/servers/actions"], "servers/actions"),
	).toBe("/servers/actions");
	expect(findPathTemplate(["/servers/{id}"], "servers//1")).toBeUndefined();
});

test("oneOf requires exactly one shape, and JSON numbers are finite", () => {
	const one = { oneOf: [{ type: "number" }, { type: "integer" }] };
	expect(listSchemaProblems(subject, one, 1, "200")).toHaveLength(1);
	expect(listSchemaProblems(subject, one, "one", "200")).toHaveLength(1);
	expect(listSchemaProblems(subject, one, nonIntegerNumber, "200")).toEqual([]);
	expect(
		listSchemaProblems(subject, { type: "number" }, Number.NaN, "200"),
	).toHaveLength(1);
});

test("an unsupported schema type is reported instead of accepting every value", () => {
	const standalone = listSchemaProblems(
		subject,
		{ type: "date-time" },
		"anything",
		"200",
	);
	expect(standalone.map((problem) => problem.message)).toEqual([
		'uses unsupported schema type "date-time"',
	]);

	const mixed = listSchemaProblems(
		subject,
		{ type: ["string", "date-time"] },
		"anything",
		"200",
	);
	expect(mixed.map((problem) => problem.message)).toEqual([
		'uses unsupported schema type "date-time"',
	]);
});

test("allOf applies to scalar, array, and null values", () => {
	const scalar = { allOf: [{ type: "string" }, { enum: ["ok"] }] };
	const array = {
		allOf: [{ type: "array" }, { items: { type: "integer" } }],
	};
	const nullable = { allOf: [{ type: ["null", "string"] }, { enum: [null] }] };

	expect(listSchemaProblems(subject, scalar, "bad", "200")).toHaveLength(1);
	expect(listSchemaProblems(subject, array, ["bad"], "200")).toHaveLength(1);
	expect(listSchemaProblems(subject, nullable, "bad", "200")).toHaveLength(1);
	expect(listSchemaProblems(subject, nullable, null, "200")).toEqual([]);
});

test("a query value is read as the type the description gives it", () => {
	const parameters = [
		{
			name: "per_page",
			in: "query",
			required: false,
			schema: { type: "integer", maximum: 50 },
		},
		{
			name: "user_id",
			in: "query",
			required: false,
			schema: { type: "array", items: { type: "string" } },
		},
	];
	const ask = (query: string) =>
		listQueryValueProblems(subject, parameters, new URLSearchParams(query));

	expect(ask("per_page=50")).toEqual([]);
	expect(ask("per_page=51")).toHaveLength(1);
	expect(ask("per_page=all")).toHaveLength(1);
	expect(ask("user_id=user_1")).toEqual([]);
	expect(ask("user_id=user_1&user_id=user_2")).toEqual([]);
	expect(ask("page=2")).toEqual([]);
});
