import type { AnySchema, ErrorObject, ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import AjvDraft4 from "ajv-draft-04";
import addFormats from "ajv-formats";
import traverse from "json-schema-traverse";

type Document = Record<string, unknown>;
export type Schema = AnySchema;

export type Described = Readonly<{
	source: string;
	holder: "paths" | "x-webhooks";
	operations: Record<string, readonly string[]>;
}>;

export type ContractSource = Readonly<{
	source: string;
	readAt: string;
	digest: string;
	holder: Described["holder"];
	document: Document;
}>;

export type Contract = Readonly<{ sources: readonly ContractSource[] }>;

export type ContractProblem = Readonly<{
	operation: string;
	at: string;
	keyword: string;
	claims: string;
	message: string;
	value?: unknown;
}>;

type Body = Readonly<{
	required: boolean;
	validate: ValidateFunction | null;
}>;

type Parameter = Readonly<{
	name: string;
	in: "path" | "query";
	required: boolean;
	isArray: boolean;
	separator: string | null;
	type: string;
	validate: ValidateFunction;
}>;

export type OpenApiOperation = Readonly<{
	parameters: readonly Parameter[];
	request: Body;
	responses: ReadonlyMap<string, Body>;
}>;

const templatePattern = /^\{([^{}]+)\}$/;
const numericPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const mapKeys = new Set([
	"properties",
	"patternProperties",
	"$defs",
	"definitions",
	"schemas",
	"paths",
	"x-webhooks",
	"responses",
	"headers",
]);
const literalKeys = new Set([
	"default",
	"enum",
	"const",
	"example",
	"examples",
]);
const openApiAnnotations = [
	"example",
	"discriminator",
	"xml",
	"externalDocs",
	"paths",
	"components",
	"x-webhooks",
];

function requireObject(value: unknown): Document {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("An OpenAPI object is missing or invalid.");
	}
	return value as Document;
}

function toPointerPart(value: string) {
	return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function toPointerParts(pointer: string) {
	if (!pointer.startsWith("#/")) {
		throw new Error(`Only local OpenAPI references are supported: ${pointer}`);
	}
	return decodeURIComponent(pointer.slice(2))
		.split("/")
		.map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function readPointer(document: Document, pointer: string): unknown {
	let value: unknown = document;
	for (const part of toPointerParts(pointer)) {
		if (
			value === null ||
			typeof value !== "object" ||
			!Object.hasOwn(value, part)
		) {
			throw new Error(`The OpenAPI reference does not exist: ${pointer}`);
		}
		value = (value as Document)[part];
	}
	return value;
}

function storePointer(document: Document, pointer: string, value: unknown) {
	const parts = toPointerParts(pointer);
	const last = parts.pop();
	let parent = document;
	for (const part of parts) {
		if (!Object.hasOwn(parent, part)) {
			Object.defineProperty(parent, part, {
				value: {},
				enumerable: true,
				writable: true,
			});
		}
		parent = requireObject(parent[part]);
	}
	if (last === undefined) {
		throw new Error("An OpenAPI reference must name a value.");
	}
	Object.defineProperty(parent, last, {
		value,
		enumerable: true,
		writable: true,
		configurable: true,
	});
}

function walkReferences(
	value: unknown,
	visit: (pointer: string) => void,
	isMap = false,
) {
	if (Array.isArray(value)) {
		for (const item of value) {
			walkReferences(item, visit);
		}
		return;
	}
	if (value === null || typeof value !== "object") {
		return;
	}
	const object = value as Document;
	if (!isMap && typeof object.$ref === "string") {
		visit(object.$ref);
	}
	for (const [key, member] of Object.entries(object)) {
		if (isMap || (!literalKeys.has(key) && !key.startsWith("x-"))) {
			walkReferences(member, visit, !isMap && mapKeys.has(key));
		}
	}
}

/** Keeps selected native operations and their reference graph without rewriting schemas. */
export function selectOpenApiDocument(
	input: unknown,
	selected: Described,
): Document {
	const document = requireObject(input);
	const holder = requireObject(document[selected.holder]);
	const paths: Document = {};
	for (const [name, methods] of Object.entries(selected.operations)) {
		const path = requireObject(holder[name]);
		paths[name] = Object.fromEntries([
			...(path.parameters === undefined
				? []
				: [["parameters", path.parameters]]),
			...methods.map((method) => [method, requireObject(path[method])]),
		]);
	}
	const result: Document = {
		openapi: document.openapi,
		...(document.jsonSchemaDialect === undefined
			? {}
			: { jsonSchemaDialect: document.jsonSchemaDialect }),
		[selected.holder]: structuredClone(paths),
	};
	const copied = new Set<string>();
	const copy = (pointer: string) => {
		if (copied.has(pointer)) {
			return;
		}
		copied.add(pointer);
		const value = structuredClone(readPointer(document, pointer));
		storePointer(result, pointer, value);
		walkReferences(value, copy);
	};
	walkReferences(paths, copy, true);
	return result;
}

function resolveObject(document: Document, pointer: string) {
	const seen = new Set<string>();
	let current = pointer;
	for (;;) {
		if (seen.has(current)) {
			throw new Error(`An OpenAPI object reference is circular: ${current}`);
		}
		seen.add(current);
		const value = requireObject(readPointer(document, current));
		if (typeof value.$ref !== "string") {
			return { value, pointer: current };
		}
		current = value.$ref;
	}
}

function normalizeOpenApi30Schema(schema: Document) {
	if (typeof schema.$ref === "string") {
		// OpenAPI 3.0 Reference Objects ignore every field beside $ref.
		for (const key of Object.keys(schema)) {
			if (key !== "$ref") {
				delete schema[key];
			}
		}
		return;
	}
	// OpenAPI 3.0 nullable affects only a type declared in the same schema.
	if (schema.type === undefined) {
		delete schema.nullable;
	}
}

function prepareSchema(
	schema: Schema,
	registerKeyword: (keyword: string) => void,
	isOpenApi30: boolean,
) {
	if (typeof schema === "boolean") {
		return;
	}
	traverse(schema, (node) => {
		if (isOpenApi30) {
			normalizeOpenApi30Schema(node);
		}
		// Draft 4 uses `id`; an OpenAPI example's data must not become schema identities.
		delete node.example;
		for (const key of Object.keys(node)) {
			if (key.startsWith("x-")) {
				registerKeyword(key);
			}
		}
	});
}

function createValidator(
	source: ContractSource,
	annotationFormats: readonly string[],
) {
	const version = source.document.openapi;
	const options = { allErrors: true, verbose: true, strictTypes: false };
	let ajv: Ajv2020 | AjvDraft4;
	if (typeof version === "string" && version.startsWith("3.0.")) {
		ajv = new AjvDraft4(options);
	} else if (typeof version === "string" && version.startsWith("3.1.")) {
		const dialect = source.document.jsonSchemaDialect;
		if (
			dialect !== undefined &&
			dialect !== "https://json-schema.org/draft/2020-12/schema" &&
			dialect !== "https://spec.openapis.org/oas/3.1/dialect/base"
		) {
			throw new Error(
				`The OpenAPI schema dialect is unsupported: ${String(dialect)}`,
			);
		}
		ajv = new Ajv2020(options);
	} else {
		throw new Error(`The OpenAPI version is unsupported: ${String(version)}`);
	}
	addFormats(ajv);
	ajv.addVocabulary(openApiAnnotations);
	if (ajv instanceof AjvDraft4) {
		ajv.addKeyword("deprecated");
	}
	for (const keyword of ["readOnly", "writeOnly"]) {
		ajv.removeKeyword(keyword).addKeyword({
			keyword,
			schemaType: "boolean",
			macro: (enabled: boolean) => {
				if (enabled) {
					throw new Error("Directional OpenAPI properties are not supported.");
				}
				return true;
			},
		});
	}
	const keywords = new Set(openApiAnnotations);
	const registerKeyword = (key: string) => {
		if (!keywords.has(key)) {
			ajv.addKeyword(key);
			keywords.add(key);
		}
	};
	for (const format of annotationFormats) {
		ajv.addFormat(format, true);
	}
	const schemas: Document = {};
	const copied = new Set<string>();
	const copy = (pointer: string) => {
		if (copied.has(pointer)) {
			return;
		}
		copied.add(pointer);
		const schema = structuredClone(
			readPointer(source.document, pointer),
		) as Schema;
		prepareSchema(schema, registerKeyword, ajv instanceof AjvDraft4);
		storePointer(schemas, pointer, schema);
		walkReferences(schema, copy);
	};
	return {
		copy,
		compile: () => {
			ajv.addSchema(schemas, source.source);
			return (pointer: string): ValidateFunction => {
				const validate = ajv.getSchema(`${source.source}${pointer}`);
				if (validate === undefined || "$async" in validate) {
					throw new Error(
						`The OpenAPI schema cannot be checked synchronously: ${pointer}`,
					);
				}
				return validate;
			};
		},
	};
}

type PendingBody = Readonly<{ required: boolean; pointer: string | null }>;

function readBody(document: Document, pointer: string): PendingBody {
	const resolved = resolveObject(document, pointer);
	const body = resolved.value;
	if (body.content === undefined) {
		return { required: false, pointer: null };
	}
	const content = requireObject(body.content);
	const json = content["application/json"];
	if (json === undefined || Object.keys(content).length !== 1) {
		throw new Error(
			`Only application/json contract bodies are supported: ${pointer}`,
		);
	}
	if (requireObject(json).schema === undefined) {
		throw new Error(`The OpenAPI JSON body has no schema: ${pointer}`);
	}
	return {
		required: body.required === true,
		pointer: `${resolved.pointer}/content/application~1json/schema`,
	};
}

function readParameters(document: Document, pointer: string, values: unknown) {
	if (values === undefined) {
		return [];
	}
	if (!Array.isArray(values)) {
		throw new Error(`The OpenAPI parameters are invalid: ${pointer}`);
	}
	return values.map((_, index) =>
		resolveObject(document, `${pointer}/${index}`),
	);
}

function toParameter(
	document: Document,
	resolved: ReturnType<typeof resolveObject>,
	validate: ValidateFunction,
): Parameter {
	const parameter = resolved.value;
	if (
		typeof parameter.name !== "string" ||
		(parameter.in !== "path" && parameter.in !== "query")
	) {
		throw new Error(
			`Only named path and query parameters are supported: ${resolved.pointer}`,
		);
	}
	const schema = resolveObject(document, `${resolved.pointer}/schema`).value;
	const isArray = schema.type === "array";
	const type = isArray ? requireObject(schema.items).type : schema.type;
	if (
		typeof type !== "string" ||
		!["string", "integer", "number", "boolean"].includes(type)
	) {
		throw new Error(
			`The OpenAPI parameter type is unsupported: ${resolved.pointer}`,
		);
	}
	const style =
		parameter.style ?? (parameter.in === "query" ? "form" : "simple");
	let separator: string | null;
	switch (style) {
		case "form":
			separator = parameter.explode === false ? "," : null;
			break;
		case "simple":
			separator = ",";
			break;
		case "spaceDelimited":
			separator = " ";
			break;
		case "pipeDelimited":
			separator = "|";
			break;
		default:
			throw new Error(
				`The OpenAPI parameter style is unsupported: ${String(style)}`,
			);
	}
	return {
		name: parameter.name,
		in: parameter.in,
		required: parameter.required === true,
		isArray,
		separator,
		type,
		validate,
	};
}

/** Compiles before any traffic, so an unsupported contract cannot make a test pass. */
export function readOpenApiOperations(
	source: ContractSource,
	annotationFormats: readonly string[] = [],
) {
	const document = source.document;
	const validator = createValidator(source, annotationFormats);
	const pending = Object.entries(
		requireObject(document[source.holder]),
	).flatMap(([path, value]) => {
		const pathItem = requireObject(value);
		const prefix = `#/${source.holder}/${toPointerPart(path)}`;
		const inherited = readParameters(
			document,
			`${prefix}/parameters`,
			pathItem.parameters,
		);
		return Object.entries(pathItem)
			.filter(([method]) => method !== "parameters")
			.map(([method, raw]) => {
				const operation = requireObject(raw);
				const pointer = `${prefix}/${method}`;
				const parameters = new Map(
					[
						...inherited,
						...readParameters(
							document,
							`${pointer}/parameters`,
							operation.parameters,
						),
					].map((parameter) => [
						`${String(parameter.value.in)} ${String(parameter.value.name)}`,
						parameter,
					]),
				);
				const request =
					operation.requestBody === undefined
						? { required: false, pointer: null }
						: readBody(document, `${pointer}/requestBody`);
				const responses = Object.keys(
					requireObject(operation.responses ?? {}),
				).map(
					(status) =>
						[
							status,
							readBody(
								document,
								`${pointer}/responses/${toPointerPart(status)}`,
							),
						] as const,
				);
				for (const parameter of parameters.values()) {
					validator.copy(`${parameter.pointer}/schema`);
				}
				for (const body of [request, ...responses.map(([, reply]) => reply)]) {
					if (body.pointer !== null) {
						validator.copy(body.pointer);
					}
				}
				return { path, method, parameters, request, responses };
			});
	});
	const compile = validator.compile();
	const toBody = (body: PendingBody): Body => ({
		required: body.required,
		validate: body.pointer === null ? null : compile(body.pointer),
	});
	return pending.map((operation) => ({
		path: operation.path,
		method: operation.method.toUpperCase(),
		described: {
			parameters: [...operation.parameters.values()].map((parameter) =>
				toParameter(
					document,
					parameter,
					compile(`${parameter.pointer}/schema`),
				),
			),
			request: toBody(operation.request),
			responses: new Map(
				operation.responses.map(([status, body]) => [
					status.toUpperCase(),
					toBody(body),
				]),
			),
		} satisfies OpenApiOperation,
	}));
}

export function findOpenApiPath(
	templates: readonly string[],
	requested: string,
) {
	const path = requested.split("?")[0] ?? "";
	const normalized = path.startsWith("/") ? path : `/${path}`;
	const segments = normalized.split("/");
	return (
		templates.find(
			(template) => template === path || template === normalized,
		) ??
		templates.find((template) => {
			const parts = template.split("/");
			return (
				parts.length === segments.length &&
				parts.every(
					(part, index) =>
						part === segments[index] ||
						(templatePattern.test(part) && segments[index] !== ""),
				)
			);
		})
	);
}

function toProblem(
	operation: string,
	at: string,
	error: ErrorObject,
): ContractProblem {
	const parameter = error.params as Record<string, unknown>;
	const missing = parameter.missingProperty ?? parameter.additionalProperty;
	const parts = error.instancePath
		.split("/")
		.slice(1)
		.map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
	if (typeof missing === "string") {
		parts.push(missing);
	}
	return {
		operation,
		at: [at, ...parts].join("."),
		keyword: error.keyword,
		claims: JSON.stringify(error.schema),
		message: error.message ?? "does not match the contract",
		value: error.data,
	};
}

function listValueProblems(
	operation: string,
	at: string,
	validate: ValidateFunction,
	value: unknown,
) {
	validate(value);
	return (validate.errors ?? []).map((error) =>
		toProblem(operation, at, error),
	);
}

export function listOpenApiBodyProblems(
	options: Readonly<{
		operation: string;
		at: string;
		body: Body;
		value: unknown;
		isReply: boolean;
	}>,
): ContractProblem[] {
	const { operation, at, body, value, isReply } = options;
	if (value === undefined) {
		return (isReply ? body.validate !== null : body.required)
			? [
					{
						operation,
						at,
						keyword: "required",
						claims: "true",
						message: "is required",
					},
				]
			: [];
	}
	if (body.validate === null) {
		return [
			{
				operation,
				at,
				keyword: "content",
				claims: "absent",
				message: "has no described body",
			},
		];
	}
	return listValueProblems(operation, at, body.validate, value);
}

function toParameterValue(type: string, value: string) {
	switch (type) {
		case "number":
		case "integer":
			return numericPattern.test(value) ? Number(value) : value;
		case "boolean":
			if (value === "true") {
				return true;
			}
			return value === "false" ? false : value;
		case "string":
			return value;
		default:
			throw new Error(`The OpenAPI parameter type is unsupported: ${type}`);
	}
}

function listParameterValues(
	parameter: Parameter,
	search: URLSearchParams,
	segment: string | undefined,
) {
	switch (parameter.in) {
		case "query":
			return search.getAll(parameter.name);
		case "path":
			return segment === undefined ? [] : [decodeURIComponent(segment)];
	}
}

function toParameterInput(parameter: Parameter, values: readonly string[]) {
	const separator = parameter.separator;
	const split =
		parameter.isArray && separator !== null
			? values.flatMap((text) => text.split(separator))
			: values;
	const converted = split.map((text) => toParameterValue(parameter.type, text));
	return parameter.isArray || converted.length > 1 ? converted : converted[0];
}

export function listOpenApiParameterProblems(
	operation: string,
	parameters: readonly Parameter[],
	requested: string,
): ContractProblem[] {
	const template = operation.slice(operation.indexOf(" ") + 1).split("/");
	const normalized = requested.startsWith("/") ? requested : `/${requested}`;
	const separator = normalized.indexOf("?");
	const path = separator < 0 ? normalized : normalized.slice(0, separator);
	const query = separator < 0 ? "" : normalized.slice(separator + 1);
	const segments = path.split("/");
	const search = new URLSearchParams(query);
	const known = new Set(
		parameters
			.filter((parameter) => parameter.in === "query")
			.map((parameter) => parameter.name),
	);
	const problems: ContractProblem[] = [...new Set(search.keys())]
		.filter((name) => !known.has(name))
		.map((name) => ({
			operation,
			at: `query.${name}`,
			keyword: "parameter",
			claims: "absent",
			message: "is not described",
		}));
	for (const parameter of parameters) {
		const at = `${parameter.in}.${parameter.name}`;
		const index = template.indexOf(`{${parameter.name}}`);
		const segment = segments[index];
		let values: string[];
		try {
			values = listParameterValues(parameter, search, segment);
		} catch {
			problems.push({
				operation,
				at,
				keyword: "encoding",
				claims: "URI",
				message: "has invalid URI encoding",
			});
			continue;
		}
		if (values.length === 0) {
			if (parameter.required) {
				problems.push({
					operation,
					at,
					keyword: "required",
					claims: "true",
					message: "is required",
				});
			}
			continue;
		}
		problems.push(
			...listValueProblems(
				operation,
				at,
				parameter.validate,
				toParameterInput(parameter, values),
			),
		);
	}
	return problems;
}
