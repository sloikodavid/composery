import { describe, expect, test } from "vitest";
import { parse } from "yaml";

import { readRepoFile } from "./support/patchSource.ts";

// A hand-written spec is a second copy of the route, and a second copy drifts
// silently: it still renders, still validates, still looks authoritative, and
// only a caller finds out. So every part of docs/openapi.yaml that restates
// something the route decides is read back out of the route here.

const ROUTES = "packages/ide/overlay/src/node/routes/api";
const exec = readRepoFile(`${ROUTES}/exec.ts`);
const auth = readRepoFile(`${ROUTES}/auth.ts`);
const index = readRepoFile(`${ROUTES}/index.ts`);

interface Spec {
	paths: Record<
		string,
		{
			post: {
				parameters: { name: string; in: string }[];
				requestBody: {
					content: Record<string, { schema: { $ref: string } }>;
				};
				responses: Record<string, unknown>;
			};
		}
	>;
	components: {
		securitySchemes: Record<
			string,
			{ type: string; scheme?: string; name?: string }
		>;
		schemas: Record<
			string,
			{ properties: Record<string, unknown>; required?: string[] }
		>;
	};
}

const spec = parse(readRepoFile("docs/openapi.yaml")) as Spec;

const basePath = /apiBasePath = "([^"]+)"/.exec(
	readRepoFile(`${ROUTES}/constants.ts`)
)?.[1];
const execPath = `${basePath}/exec`;
const operation = spec.paths[execPath]?.post;

// Fields of a `interface Name { ... }` declaration, in source order.
function interfaceFields(source: string, name: string): string[] {
	const body = new RegExp(`interface ${name} \\{([^}]*)\\}`).exec(source)?.[1];
	if (body === undefined) throw new Error(`No interface ${name}`);
	return [...body.matchAll(/^\s*(\w+)\??:/gm)].map((match) => match[1] ?? "");
}

describe("the API spec matches the route that serves it", () => {
	test("documents the path the router mounts, and only that one", () => {
		expect(basePath).toBeTruthy();
		expect(Object.keys(spec.paths)).toEqual([execPath]);
	});

	test("the page renders the operation the spec defines", () => {
		expect(readRepoFile("docs/api.mdx")).toContain(
			`<APIOperation path="${execPath}" method="post" />`
		);
	});

	test("documents every status the HTTP routes can return, and no others", () => {
		// `res.json(...)` with no status is the 200; everything else is explicit,
		// either as `res.status(N)` or as an `AuthResult` the handler forwards.
		const returned = new Set(["200"]);
		for (const match of `${exec}\n${auth}\n${index}`.matchAll(
			/res\.status\((\d{3})\)|status:\s*(\d{3})/g
		)) {
			returned.add(match[1] ?? match[2] ?? "");
		}

		expect([...returned].sort()).toEqual(
			Object.keys(operation?.responses ?? {}).sort()
		);
	});

	test("the request body is the body the handler reads", () => {
		const schema = spec.components.schemas.ExecRequest;
		expect(Object.keys(schema?.properties ?? {})).toEqual(
			interfaceFields(exec, "ExecBody")
		);
		// `ExecBody` marks every field optional because the check is at runtime.
		expect(schema?.required).toEqual(["command"]);
		expect(exec).toContain(`typeof body.command !== "string"`);
	});

	test("the response is the result the handler resolves", () => {
		const fields = interfaceFields(exec, "ExecResult");
		const schema = spec.components.schemas.ExecResult;
		expect(Object.keys(schema?.properties ?? {})).toEqual(fields);
		// Every field is always present, so none of them is optional to a caller.
		expect(schema?.required).toEqual(fields);
	});

	test("the documented auth headers are the headers that authenticate", () => {
		const schemes = spec.components.securitySchemes;
		const bearer = Object.values(schemes).find((s) => s.type === "http");
		const apiKey = Object.values(schemes).find((s) => s.type === "apiKey");

		// Lowercased on both sides: OpenAPI spells the scheme `bearer`, the header
		// it matches is `Bearer `, and Node lowercases every header name it stores.
		expect(auth.toLowerCase()).toContain(`startswith("${bearer?.scheme} ")`);
		expect(auth).toContain(`headers["${apiKey?.name?.toLowerCase()}"]`);
	});

	test("the idempotency header is the header the handler reads", () => {
		const header = operation?.parameters?.find((p) => p.in === "header");
		expect(header).toBeTruthy();
		expect(exec).toContain(`req.headers["${header?.name.toLowerCase()}"]`);
	});
});
