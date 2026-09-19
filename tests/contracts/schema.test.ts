import { expect, test } from "bun:test";
import {
	findPathTemplate,
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

	// What the system reads is a number, and it says how large it may be.
	expect(ask("per_page=50")).toEqual([]);
	expect(ask("per_page=51")).toHaveLength(1);
	expect(ask("per_page=all")).toHaveLength(1);
	// A list is written as one name repeated, so asking once is a list of one.
	expect(ask("user_id=user_1")).toEqual([]);
	expect(ask("user_id=user_1&user_id=user_2")).toEqual([]);
	// A name the description says nothing about is somebody else's problem to report.
	expect(ask("page=2")).toEqual([]);
});
