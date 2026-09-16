/**
 * Writes the part of Hetzner's published API description that Composery depends on into
 * `tests/harness/hetzner-contract.json`, so tests can check what we send and what we accept
 * against Hetzner's own words instead of ours.
 *
 * Run it to see whether Hetzner has changed: `bun scripts/hetzner-contract.ts`. A change in the
 * written file is a change in the contract, and it is reviewed like any other change.
 */

const specUrl = "https://docs.hetzner.cloud/cloud.spec.json";
const output = "tests/harness/hetzner-contract.json";
// Every request Composery sends, by the path and method it sends it with.
const operations: Record<string, readonly string[]> = {
	"/servers": ["get", "post"],
	"/servers/{id}": ["get", "delete"],
	"/servers/{id}/actions/poweron": ["post"],
	"/servers/{id}/actions/shutdown": ["post"],
	"/servers/{id}/actions/poweroff": ["post"],
	"/primary_ips": ["get", "post"],
	"/primary_ips/{id}": ["get", "delete"],
	"/actions/{id}": ["get"],
	"/firewalls/{id}": ["get"],
	"/server_types": ["get"],
	"/images": ["get"],
};
// What a check reads. Prose and examples are left behind, so a reviewer sees only the shape.
const keptKeys = new Set([
	"type",
	"properties",
	"required",
	"items",
	"enum",
	"additionalProperties",
	"anyOf",
	"oneOf",
	"allOf",
]);
const successPattern = /^2/;

/** Keeps what a check reads from one schema, and every field name under `properties`. */
function toShape(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(toShape);
	}
	if (value === null || typeof value !== "object") {
		return value;
	}
	const shape: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		if (key === "properties" && item !== null && typeof item === "object") {
			shape[key] = Object.fromEntries(
				Object.entries(item).map(([name, field]) => [name, toShape(field)]),
			);
			continue;
		}
		if (key === "required" || key === "enum" || key === "type") {
			shape[key] = item;
			continue;
		}
		if (keptKeys.has(key)) {
			shape[key] = toShape(item);
		}
	}
	return shape;
}

const reply = await fetch(specUrl);
if (!reply.ok) {
	throw new Error(`Hetzner's API description answered ${reply.status}.`);
}
const spec = (await reply.json()) as {
	paths: Record<
		string,
		Record<string, { responses?: Record<string, unknown> }>
	>;
};
const paths: Record<string, Record<string, unknown>> = {};
for (const [path, methods] of Object.entries(operations)) {
	const described = spec.paths[path];
	if (described === undefined) {
		throw new Error(`Hetzner no longer describes ${path}.`);
	}
	paths[path] = {};
	for (const method of methods) {
		const operation = described[method];
		if (operation === undefined) {
			throw new Error(`Hetzner no longer describes ${method} ${path}.`);
		}
		const responses: Record<string, unknown> = {};
		for (const [status, response] of Object.entries(
			operation.responses ?? {},
		)) {
			if (!successPattern.test(status)) {
				continue;
			}
			const schema = (
				response as {
					content?: { "application/json"?: { schema?: unknown } };
				}
			).content?.["application/json"]?.schema;
			responses[status] = schema === undefined ? {} : toShape(schema);
		}
		paths[path][method] = responses;
	}
}
const text = `${JSON.stringify({ source: specUrl, paths }, null, "\t")}\n`;
const previous = await Bun.file(output)
	.text()
	.catch(() => "");
await Bun.write(output, text);
console.log(
	previous === text
		? `${output} is unchanged: Hetzner still describes what we send the same way.`
		: `${output} changed. Read the difference: Hetzner's contract moved.`,
);
