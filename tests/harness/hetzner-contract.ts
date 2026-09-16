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

type Contract = {
	source: string;
	paths: Record<string, Record<string, Record<string, Schema>>>;
};

const contractPath = path.join(import.meta.dir, "hetzner-contract.json");
const templatePattern = /\{[^}]+\}/;
const queryPattern = /\?.*$/;

let contract: Contract | undefined;

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
 * What is wrong with one reply, against Hetzner's description of that request. An empty list
 * means Hetzner could have sent it. A request Hetzner does not describe is a problem too: it
 * means we ask for something that no longer exists.
 */
export async function checkHetznerReply(
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
	const schema = operation[String(status)];
	if (schema === undefined) {
		return [`Hetzner does not describe a ${status} for ${method} ${template}`];
	}
	const problems: string[] = [];
	collectProblems(schema, body, `${method} ${template} ${status}`, problems);
	return problems;
}
