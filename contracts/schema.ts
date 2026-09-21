/** Minimal JSON Schema needed by the pinned contract checker. */
export type Schema = {
	type?: string | string[];
	properties?: Record<string, Schema>;
	additionalProperties?: boolean | Schema;
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

const templatePattern = /^\{[^{}]+\}$/;
const queryPattern = /\?.*$/;

function toSegments(value: string) {
	const path = value.replace(queryPattern, "");
	const normalized = path.startsWith("/") ? path : `/${path}`;
	return normalized.split("/").slice(1);
}

export function findPathTemplate(
	templates: readonly string[],
	requested: string,
) {
	const segments = toSegments(requested);
	const exact = templates.find(
		(template) =>
			toSegments(template).join("/") === segments.join("/") &&
			toSegments(template).every((part) => !templatePattern.test(part)),
	);
	if (exact !== undefined) {
		return exact;
	}
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

const schemaTypes = new Set([
	"array",
	"boolean",
	"integer",
	"null",
	"number",
	"object",
	"string",
]);

function isType(value: unknown, type: string) {
	switch (type) {
		case "object":
			return (
				value !== null && typeof value === "object" && !Array.isArray(value)
			);
		case "array":
			return Array.isArray(value);
		case "integer":
			return (
				typeof value === "number" &&
				Number.isFinite(value) &&
				Number.isInteger(value)
			);
		case "number":
			return typeof value === "number" && Number.isFinite(value);
		case "string":
			return typeof value === "string";
		case "boolean":
			return typeof value === "boolean";
		case "null":
			return value === null;
		default:
			return false;
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
	if (schema.oneOf !== undefined) {
		collectAlternatives({
			collector,
			alternatives: schema.oneOf,
			value,
			at,
			mode: "one",
		});
	}
	if (schema.anyOf !== undefined) {
		collectAlternatives({
			collector,
			alternatives: schema.anyOf,
			value,
			at,
			mode: "any",
		});
	}
	// allOf applies to every JSON value. Keep it before the object and array
	// branches so a scalar, array, or null value cannot skip a subschema.
	for (const part of schema.allOf ?? []) {
		collect(collector, part, value, at);
	}
	const types = toTypes(schema);
	const unknownTypes = types.filter((type) => !schemaTypes.has(type));
	for (const type of unknownTypes) {
		add(
			collector,
			at,
			"a supported JSON Schema type",
			`uses unsupported schema type ${JSON.stringify(type)}`,
		);
	}
	const knownTypes = types.filter((type) => schemaTypes.has(type));
	if (
		knownTypes.length > 0 &&
		!knownTypes.some((type) => isType(value, type))
	) {
		const claims = knownTypes.join(" or ");
		add(collector, at, claims, `is ${JSON.stringify(value)}, not ${claims}`);
		return;
	}
	if (types.length > 0 && knownTypes.length === 0) {
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
		if (!Object.hasOwn(fields, name)) {
			add(
				collector,
				`${at}.${name}`,
				"required",
				`is missing, and ${collector.system} always sends it`,
			);
		}
	}
	for (const [name, field] of Object.entries(schema.properties ?? {})) {
		if (Object.hasOwn(fields, name)) {
			collect(collector, field, fields[name], `${at}.${name}`);
		}
	}
	const described = schema.properties ?? {};
	for (const [name, field] of Object.entries(fields)) {
		if (Object.hasOwn(described, name)) {
			continue;
		}
		if (schema.additionalProperties === false) {
			add(
				collector,
				`${at}.${name}`,
				"no additional properties",
				`is sent, and ${collector.system} does not describe it`,
			);
		} else if (
			schema.additionalProperties !== undefined &&
			schema.additionalProperties !== true
		) {
			collect(collector, schema.additionalProperties, field, `${at}.${name}`);
		}
	}
}

function collectAlternatives({
	collector,
	alternatives,
	value,
	at,
	mode,
}: Readonly<{
	collector: Collector;
	alternatives: readonly Schema[];
	value: unknown;
	at: string;
	mode: "one" | "any";
}>) {
	const fitCount = alternatives.filter(
		(alternative) =>
			listSchemaProblems(collector, alternative, value, at).length === 0,
	).length;
	const fits = mode === "one" ? fitCount === 1 : fitCount > 0;
	if (!fits) {
		add(
			collector,
			at,
			mode === "one"
				? `exactly one of ${alternatives.length} shapes`
				: `one of ${alternatives.length} shapes`,
			`is ${JSON.stringify(value)}, which fits ${
				mode === "one" && fitCount > 1 ? "more than one" : "none"
			} of the shapes ${collector.system} describes here`,
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
	if (schema.additionalProperties !== undefined) {
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

export function listMissingQueryProblems(
	subject: ContractSubject,
	parameters: readonly Parameter[],
	query: URLSearchParams,
): ContractProblem[] {
	return parameters
		.filter(
			(parameter) =>
				parameter.in === "query" &&
				parameter.required &&
				!query.has(parameter.name),
		)
		.map((parameter) => ({
			operation: subject.operation,
			at: `query.${parameter.name}`,
			claims: "required",
			message: `is missing, and ${subject.system} requires it`,
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
