/** Minimal JSON Schema needed by the pinned contract checker. */
export type Schema = {
	type?: string | string[];
	properties?: Record<string, Schema>;
	required?: string[];
	items?: Schema;
	enum?: unknown[];
	maximum?: number;
	minimum?: number;
	anyOf?: Schema[];
	oneOf?: Schema[];
	allOf?: Schema[];
};

export type Parameter = Readonly<{
	name: string;
	in: string;
	required: boolean;
	schema?: Schema;
}>;

export type Operation = Readonly<{
	parameters: readonly Parameter[];
	request: Schema;
	responses: Record<string, Schema>;
}>;

export type ContractSource = Readonly<{
	source: string;
	readAt: string;
	digest: string;
}>;

export type Contract = Readonly<{
	sources: readonly ContractSource[];
	paths: Record<string, Record<string, Operation>>;
}>;

export type ContractProblem = Readonly<{
	operation: string;
	at: string;
	claims: string;
	message: string;
}>;

export function toProblemText(problem: ContractProblem) {
	return `${problem.operation} ${problem.at} ${problem.message}`;
}

const templatePattern = /\{[^}]+\}/;
const queryPattern = /\?.*$/;

function toSegments(value: string) {
	return value.replace(queryPattern, "").split("/").filter(Boolean);
}

export function findPathTemplate(
	templates: readonly string[],
	requested: string,
) {
	const segments = toSegments(requested);
	return templates.find((template) => {
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

export type ContractSubject = Readonly<{
	system: string;
	operation: string;
}>;

type Collector = ContractSubject & Readonly<{ problems: ContractProblem[] }>;

function add(
	collector: Collector,
	at: string,
	claims: string,
	message: string,
) {
	collector.problems.push({
		operation: collector.operation,
		at,
		claims,
		message,
	});
}

function collectBounds(
	collector: Collector,
	schema: Schema,
	value: number,
	at: string,
) {
	if (schema.maximum !== undefined && value > schema.maximum) {
		add(
			collector,
			at,
			`at most ${schema.maximum}`,
			`is ${value}, which is more than ${collector.system} reads`,
		);
	}
	if (schema.minimum !== undefined && value < schema.minimum) {
		add(
			collector,
			at,
			`at least ${schema.minimum}`,
			`is ${value}, which is less than ${collector.system} reads`,
		);
	}
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one branch per schema part
function collect(
	collector: Collector,
	schema: Schema,
	value: unknown,
	at: string,
) {
	for (const alternatives of [schema.oneOf, schema.anyOf]) {
		if (alternatives !== undefined) {
			collectAlternatives(collector, alternatives, value, at);
		}
	}
	const types = toTypes(schema);
	if (types.length > 0 && !types.some((type) => isType(value, type))) {
		const claims = types.join(" or ");
		add(collector, at, claims, `is ${JSON.stringify(value)}, not ${claims}`);
		return;
	}
	if (schema.enum !== undefined && !schema.enum.includes(value)) {
		add(
			collector,
			at,
			schema.enum.join(" or "),
			`is ${JSON.stringify(value)}, which ${collector.system} never sends`,
		);
	}
	if (typeof value === "number") {
		collectBounds(collector, schema, value, at);
	}
	if (Array.isArray(value) && schema.items !== undefined) {
		for (const [index, item] of value.entries()) {
			collect(collector, schema.items, item, `${at}[${index}]`);
		}
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return;
	}
	const fields = value as Record<string, unknown>;
	for (const name of schema.required ?? []) {
		if (!(name in fields)) {
			add(
				collector,
				`${at}.${name}`,
				"required",
				`is missing, and ${collector.system} always sends it`,
			);
		}
	}
	for (const [name, field] of Object.entries(schema.properties ?? {})) {
		if (name in fields) {
			collect(collector, field, fields[name], `${at}.${name}`);
		}
	}
	for (const part of schema.allOf ?? []) {
		collect(collector, part, value, at);
	}
}

function collectAlternatives(
	collector: Collector,
	alternatives: readonly Schema[],
	value: unknown,
	at: string,
) {
	const fits = alternatives.some(
		(alternative) =>
			listSchemaProblems(collector, alternative, value, at).length === 0,
	);
	if (!fits) {
		add(
			collector,
			at,
			`one of ${alternatives.length} shapes`,
			`is ${JSON.stringify(value)}, which fits none of the shapes ${collector.system} describes here`,
		);
	}
}

export function listSchemaProblems(
	subject: ContractSubject,
	schema: Schema,
	value: unknown,
	at: string,
): ContractProblem[] {
	const collector: Collector = { ...subject, problems: [] };
	collect(collector, schema, value, at);
	return collector.problems;
}

export function listUnreadFieldProblems(
	subject: ContractSubject,
	schema: Schema,
	body: unknown,
): ContractProblem[] {
	if (
		schema.properties === undefined ||
		body === null ||
		typeof body !== "object" ||
		Array.isArray(body)
	) {
		return [];
	}
	const described = schema.properties;
	return Object.keys(body)
		.filter((name) => !(name in described))
		.map((name) => ({
			operation: subject.operation,
			at: `body.${name}`,
			claims: "absent",
			message: `is sent, and ${subject.system} does not read it`,
		}));
}

export function listUnreadQueryProblems(
	subject: ContractSubject,
	parameters: readonly Parameter[],
	query: URLSearchParams,
): ContractProblem[] {
	const known = new Set(
		parameters
			.filter((parameter) => parameter.in === "query")
			.map((parameter) => parameter.name),
	);
	return [...new Set(query.keys())]
		.filter((name) => !known.has(name))
		.map((name) => ({
			operation: subject.operation,
			at: `query.${name}`,
			claims: "absent",
			message: `is asked for, and ${subject.system} does not read it`,
		}));
}

export function listQueryValueProblems(
	subject: ContractSubject,
	parameters: readonly Parameter[],
	query: URLSearchParams,
): ContractProblem[] {
	const collector: Collector = { ...subject, problems: [] };
	for (const parameter of parameters) {
		const value = query.get(parameter.name);
		if (parameter.in !== "query" || parameter.schema === undefined) {
			continue;
		}
		if (value !== null) {
			collect(
				collector,
				parameter.schema,
				toAskedValue(parameter.schema, query, parameter.name),
				`query.${parameter.name}`,
			);
		}
	}
	return collector.problems;
}

function toAskedValue(schema: Schema, query: URLSearchParams, name: string) {
	if (!toTypes(schema).includes("array")) {
		return toQueryValue(schema, query.get(name) ?? "");
	}
	return query
		.getAll(name)
		.map((item) => toQueryValue(schema.items ?? {}, item));
}

function toQueryValue(schema: Schema, value: string): unknown {
	const types = toTypes(schema);
	if (types.includes("integer") || types.includes("number")) {
		const read = Number(value);
		return value.trim() === "" || Number.isNaN(read) ? value : read;
	}
	if (types.includes("boolean") && (value === "true" || value === "false")) {
		return value === "true";
	}
	return value;
}
