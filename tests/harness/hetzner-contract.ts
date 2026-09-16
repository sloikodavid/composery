import path from "node:path";

/**
 * Hetzner's own description of what it sends, as `scripts/hetzner-contract.ts` wrote it down.
 * The fake checks every reply against it, so the fake cannot answer in a shape Hetzner never
 * would, and a change at Hetzner shows up as a difference in that file rather than as a
 * surprise in production.
 */

type Schema = {
	type?: string | string[];
	properties?: Record<string, Schema>;
	required?: string[];
	items?: Schema;
	enum?: unknown[];
	anyOf?: Schema[];
	oneOf?: Schema[];
	allOf?: Schema[];
};

type Operation = {
	parameters: { name: string; in: string; required: boolean }[];
	request: Schema;
	responses: Record<string, Schema>;
};

type Contract = {
	source: string;
	paths: Record<string, Record<string, Operation>>;
};

const contractPath = path.join(import.meta.dir, "hetzner-contract.json");
const templatePattern = /\{[^}]+\}/;
const queryPattern = /\?.*$/;

/**
 * Where Hetzner's description and Hetzner itself disagree, with the evidence. A description is
 * Hetzner's word about itself, not Hetzner: when running it says otherwise, running wins, and the
 * difference is named here rather than quietly ignored.
 */
const knownDifferences: Record<string, string> = {
	// The description says `image` and `server_type` are strings. Hetzner's own Go client sends
	// the ID as a number (`IDOrName.MarshalJSON` marshals `o.ID`), and servers were created this
	// way against real Hetzner in this repository.
	"POST /servers body.image": "Hetzner reads an ID here as well as a name",
	"POST /servers body.server_type":
		"Hetzner reads an ID here as well as a name",
};

let contract: Contract | undefined;

/** Drops the differences we have already chased down, so only new ones are reported. */
function withoutKnownDifferences(problems: readonly string[]) {
	return problems.filter(
		(problem) =>
			!Object.keys(knownDifferences).some((known) => problem.startsWith(known)),
	);
}

async function requireContract() {
	contract ??= (await Bun.file(contractPath).json()) as Contract;
	return contract;
}

function toSegments(value: string) {
	return value.replace(queryPattern, "").split("/").filter(Boolean);
}

/** Hetzner's path for a request, such as `/servers/{id}` for `servers/1005`. */
function findTemplate(known: readonly string[], requested: string) {
	const segments = toSegments(requested);
	return known.find((template) => {
		const parts = toSegments(template);
		return (
			parts.length === segments.length &&
			parts.every(
				(part, index) => templatePattern.test(part) || part === segments[index],
			)
		);
	});
}

function toTypes(schema: Schema) {
	if (schema.type === undefined) {
		return [];
	}
	return Array.isArray(schema.type) ? schema.type : [schema.type];
}

function isType(value: unknown, type: string) {
	switch (type) {
		case "object":
			return (
				value !== null && typeof value === "object" && !Array.isArray(value)
			);
		case "array":
			return Array.isArray(value);
		case "integer":
			return typeof value === "number" && Number.isInteger(value);
		case "number":
			return typeof value === "number";
		case "string":
			return typeof value === "string";
		case "boolean":
			return typeof value === "boolean";
		case "null":
			return value === null;
		default:
			return true;
	}
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one branch for each part of a schema
function collectProblems(
	schema: Schema,
	value: unknown,
	where: string,
	problems: string[],
) {
	const types = toTypes(schema);
	if (types.length > 0 && !types.some((type) => isType(value, type))) {
		problems.push(
			`${where} is ${JSON.stringify(value)}, not ${types.join(" or ")}`,
		);
		return;
	}
	if (schema.enum !== undefined && !schema.enum.includes(value)) {
		problems.push(
			`${where} is ${JSON.stringify(value)}, which Hetzner never sends`,
		);
	}
	if (Array.isArray(value) && schema.items !== undefined) {
		for (const [index, item] of value.entries()) {
			collectProblems(schema.items, item, `${where}[${index}]`, problems);
		}
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return;
	}
	const fields = value as Record<string, unknown>;
	for (const name of schema.required ?? []) {
		if (!(name in fields)) {
			problems.push(`${where}.${name} is missing, and Hetzner always sends it`);
		}
	}
	for (const [name, field] of Object.entries(schema.properties ?? {})) {
		if (name in fields) {
			collectProblems(field, fields[name], `${where}.${name}`, problems);
		}
	}
	for (const part of schema.allOf ?? []) {
		collectProblems(part, value, where, problems);
	}
}

/**
 * What is wrong with one request Composery sent: a query it asks for that Hetzner does not
 * have, or a body that Hetzner would refuse. This is the half that checks our own code.
 */
export async function listHetznerRequestProblems(
	method: string,
	requested: string,
	body: unknown,
): Promise<string[]> {
	const described = await requireContract();
	const template = findTemplate(Object.keys(described.paths), requested);
	const operation =
		template === undefined
			? undefined
			: described.paths[template]?.[method.toLowerCase()];
	if (template === undefined || operation === undefined) {
		return [`Hetzner does not describe ${method} ${requested}`];
	}
	const problems: string[] = [];
	const query = new URLSearchParams(requested.split("?")[1] ?? "");
	const known = new Set(
		operation.parameters
			.filter((parameter) => parameter.in === "query")
			.map((parameter) => parameter.name),
	);
	for (const name of query.keys()) {
		if (!known.has(name)) {
			problems.push(
				`${method} ${template} asks for ${name}, which Hetzner does not read`,
			);
		}
	}
	if (body !== undefined) {
		collectProblems(
			operation.request,
			body,
			`${method} ${template} body`,
			problems,
		);
		for (const name of Object.keys(body as Record<string, unknown>)) {
			if (
				operation.request.properties !== undefined &&
				!(name in operation.request.properties)
			) {
				problems.push(
					`${method} ${template} body sends ${name}, which Hetzner does not read`,
				);
			}
		}
	}
	return withoutKnownDifferences(problems);
}

/**
 * What is wrong with one reply, against Hetzner's description of that request. An empty list
 * means Hetzner could have sent it. A request Hetzner does not describe is a problem too: it
 * means we ask for something that no longer exists.
 */
export async function listHetznerReplyProblems(
	method: string,
	requested: string,
	status: number,
	body: unknown,
): Promise<string[]> {
	const described = await requireContract();
	const template = findTemplate(Object.keys(described.paths), requested);
	if (template === undefined) {
		return [`Hetzner does not describe ${method} ${requested}`];
	}
	const operation = described.paths[template]?.[method.toLowerCase()];
	if (operation === undefined) {
		return [`Hetzner does not describe ${method} ${template}`];
	}
	const schema = operation.responses[String(status)];
	if (schema === undefined) {
		return [`Hetzner does not describe a ${status} for ${method} ${template}`];
	}
	const problems: string[] = [];
	collectProblems(schema, body, `${method} ${template} ${status}`, problems);
	return withoutKnownDifferences(problems);
}
