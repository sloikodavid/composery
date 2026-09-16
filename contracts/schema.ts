/**
 * The part of a JSON Schema that a pinned contract keeps, and what it decides about one value.
 * A contract is an outside system's own description of itself, so a problem here always reads as
 * "the system would not have said this", never as "our rule refuses it".
 */

export type Schema = {
	type?: string | string[];
	properties?: Record<string, Schema>;
	required?: string[];
	items?: Schema;
	enum?: unknown[];
	anyOf?: Schema[];
	oneOf?: Schema[];
	allOf?: Schema[];
};

export type Parameter = Readonly<{
	name: string;
	in: string;
	required: boolean;
}>;

export type Operation = Readonly<{
	parameters: readonly Parameter[];
	request: Schema;
	responses: Record<string, Schema>;
}>;

/** Where one published document came from, and what it was when we read it. */
export type ContractSource = Readonly<{
	source: string;
	readAt: string;
	/** A digest of the whole published document, so a change upstream is visible as one line. */
	digest: string;
}>;

/** What a system's published descriptions said, on the day `scripts/contracts.ts` read them. */
export type Contract = Readonly<{
	sources: readonly ContractSource[];
	paths: Record<string, Record<string, Operation>>;
}>;

/**
 * One way a value disagreed with the description. It is split so that a waiver can name exactly
 * one place, instead of matching the beginning of a sentence.
 */
export type ContractProblem = Readonly<{
	/** The operation the description names: `POST /servers`. */
	operation: string;
	/** The place inside it: `body.image`, `query.name`, or `200.server.status`. */
	at: string;
	/** What the description says there, so a waiver stops applying when that changes. */
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

/** The description's path for a request, such as `/servers/{id}` for `servers/1005`. */
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

/** Who is being read, and under which operation. The two always travel together. */
export type ContractSubject = Readonly<{
	/** The system's name, as it appears in a problem: `Hetzner`, `Clerk`. */
	system: string;
	/** The operation the description names: `POST /servers`. */
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one branch for each part of a schema
function collect(
	collector: Collector,
	schema: Schema,
	value: unknown,
	at: string,
) {
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

/** Every way one value disagrees with the schema the description gives for it. */
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

/** Every field a request sends that the description does not read. */
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

/** Every query a request asks for that the description does not read. */
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
