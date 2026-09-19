import { createHash } from "node:crypto";
import path from "node:path";
import type { Described } from "../contracts/check";
import { clerkDescribed } from "../contracts/clerk";
import { hetznerDescribed } from "../contracts/hetzner";
import type {
	Contract,
	ContractSource,
	Operation,
	Schema,
} from "../contracts/schema";

type Document = Record<string, unknown>;

/** Fetches vendor descriptions only here; tests read the pinned files offline. */

const shapeKeys = new Set([
	"type",
	"properties",
	"required",
	"items",
	"enum",
	"maximum",
	"minimum",
	"additionalProperties",
	"anyOf",
	"oneOf",
	"allOf",
]);
const yamlPattern = /\.ya?ml$/;
const jsonPointerPrefix = "#/";

function isRecord(value: unknown): value is Document {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function follow(document: Document, pointer: string): unknown {
	if (!pointer.startsWith(jsonPointerPrefix)) {
		throw new Error(`Only pointers inside the document are read: ${pointer}`);
	}
	let node: unknown = document;
	for (const raw of pointer.slice(jsonPointerPrefix.length).split("/")) {
		const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
		if (!isRecord(node)) {
			throw new Error(`${pointer} does not exist in the description.`);
		}
		node = node[key];
	}
	if (node === undefined) {
		throw new Error(`${pointer} does not exist in the description.`);
	}
	return node;
}

function toShape(
	document: Document,
	value: unknown,
	open: readonly string[],
): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => toShape(document, item, open));
	}
	if (!isRecord(value)) {
		return value;
	}
	const pointer = value.$ref;
	if (typeof pointer === "string") {
		return open.includes(pointer)
			? {}
			: toShape(document, follow(document, pointer), [...open, pointer]);
	}
	const shape: Document = {};
	for (const [key, item] of Object.entries(value)) {
		if (shapeKeys.has(key)) {
			shape[key] = toMember(document, key, item, open);
		}
	}
	return withNullable(value, shape);
}

function toMember(
	document: Document,
	key: string,
	item: unknown,
	open: readonly string[],
): unknown {
	if (key === "required" || key === "enum") {
		return item;
	}
	if (key === "properties" && isRecord(item)) {
		return Object.fromEntries(
			Object.entries(item).map(([name, field]) => [
				name,
				toShape(document, field, open),
			]),
		);
	}
	return toShape(document, item, open);
}

function withNullable(value: Document, shape: Document) {
	if (value.nullable !== true || shape.type === undefined) {
		return shape;
	}
	const types = Array.isArray(shape.type) ? shape.type : [shape.type];
	return { ...shape, type: [...types, "null"] };
}

function toBodySchema(document: Document, holder: unknown): Schema {
	if (!isRecord(holder)) {
		return {};
	}
	const content = isRecord(holder.content) ? holder.content : undefined;
	const json = content === undefined ? undefined : content["application/json"];
	const schema = isRecord(json) ? json.schema : undefined;
	return schema === undefined ? {} : (toShape(document, schema, []) as Schema);
}

function toOperation(document: Document, described: Document): Operation {
	const parameters = Array.isArray(described.parameters)
		? described.parameters.map((parameter) => {
				const resolved = toShapeParameter(document, parameter);
				const schema = isRecord(resolved.schema)
					? (toShape(document, resolved.schema, []) as Schema)
					: undefined;
				return {
					name: resolved.name,
					in: resolved.in,
					required: resolved.required === true,
					...(schema === undefined ? {} : { schema }),
				};
			})
		: [];
	const responses: Record<string, Schema> = {};
	const describedReplies = isRecord(described.responses)
		? described.responses
		: {};
	for (const [status, response] of Object.entries(describedReplies)) {
		const resolved =
			isRecord(response) && typeof response.$ref === "string"
				? follow(document, response.$ref)
				: response;
		responses[status] = toBodySchema(document, resolved);
	}
	return {
		parameters,
		request: toBodySchema(document, described.requestBody),
		responses,
	};
}

function toShapeParameter(document: Document, parameter: unknown) {
	const resolved =
		isRecord(parameter) && typeof parameter.$ref === "string"
			? follow(document, parameter.$ref)
			: parameter;
	if (!isRecord(resolved)) {
		throw new Error("A parameter is not an object.");
	}
	return resolved as {
		name: string;
		in: string;
		required?: boolean;
		schema?: unknown;
	};
}

async function readDocument(source: string) {
	const reply = await fetch(source);
	if (!reply.ok) {
		throw new Error(`${source} answered ${reply.status}.`);
	}
	const text = await reply.text();
	const digest = createHash("sha256").update(text).digest("hex");
	const parsed: unknown = yamlPattern.test(new URL(source).pathname)
		? Bun.YAML.parse(text)
		: JSON.parse(text);
	if (!isRecord(parsed)) {
		throw new Error(`${source} is not a description.`);
	}
	return { document: parsed, digest };
}

function toSelectedPaths(
	system: string,
	document: Document,
	selected: Described,
) {
	const holder = document[selected.holder];
	if (!isRecord(holder)) {
		throw new Error(`${system} no longer publishes ${selected.holder}.`);
	}
	const paths: Record<string, Record<string, Operation>> = {};
	for (const [name, methods] of Object.entries(selected.operations)) {
		const described = holder[name];
		if (!isRecord(described)) {
			throw new Error(`${system} no longer describes ${name}.`);
		}
		paths[name] = {};
		for (const method of methods) {
			const operation = described[method];
			if (!isRecord(operation)) {
				throw new Error(`${system} no longer describes ${method} ${name}.`);
			}
			paths[name][method] = toOperation(document, operation);
		}
	}
	return paths;
}

async function writePinnedContract(
	system: string,
	described: readonly Described[],
	output: string,
) {
	const paths: Record<string, Record<string, Operation>> = {};
	const sources: ContractSource[] = [];
	const readAt = new Date().toISOString().slice(0, 10);

	for (const selected of described) {
		const { document, digest } = await readDocument(selected.source);
		sources.push({ source: selected.source, readAt, digest });
		Object.assign(paths, toSelectedPaths(system, document, selected));
	}

	const contract: Contract = { sources, paths };
	const text = `${JSON.stringify(contract, null, "\t")}\n`;
	const previous = await Bun.file(output)
		.text()
		.catch(() => "");
	await Bun.write(output, text);
	const withoutDate = (value: string) =>
		value.replace(/"readAt": "[^"]*"/g, '"readAt": ""');
	console.log(
		withoutDate(previous) === withoutDate(text)
			? `${output} is unchanged: ${system} still describes what we send the same way.`
			: `${output} changed. Read the difference: ${system}'s contract moved.`,
	);
}

const here = path.join(import.meta.dir, "..", "contracts");
await writePinnedContract(
	"Hetzner",
	[hetznerDescribed],
	path.join(here, "hetzner.json"),
);
await writePinnedContract(
	"Clerk",
	clerkDescribed,
	path.join(here, "clerk.json"),
);
