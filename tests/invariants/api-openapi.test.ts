import { describe, expect, test } from "vitest";
import { parse } from "yaml";

import { readRepoFile } from "../support/repo.ts";

// A hand-written spec is a second copy of the routes, and a second copy drifts
// silently: it still renders, still validates, still reads as authoritative, and
// only a caller finds out. Everything here reads the real thing back out of the
// route source rather than restating it.

const ROUTES = "packages/ide/overlay/src/node/routes/api";
const terminals = readRepoFile(`${ROUTES}/terminals.ts`);
const auth = readRepoFile(`${ROUTES}/auth.ts`);
const index = readRepoFile(`${ROUTES}/index.ts`);
const config = readRepoFile(`${ROUTES}/config.ts`);
const rateLimit = readRepoFile(`${ROUTES}/ratelimit.ts`);
const docs = readRepoFile("docs/api.mdx");

interface Operation {
	parameters?: { name: string; in: string }[];
	responses: Record<string, unknown>;
}

const spec = parse(readRepoFile("docs/openapi.yaml")) as {
	paths: Record<string, Record<string, Operation>>;
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
};

const basePath = /apiBasePath = "([^"]+)"/.exec(
	readRepoFile(`${ROUTES}/constants.ts`)
)?.[1];
const collection = `${basePath}/terminals`;
const member = `${collection}/{id}`;

function operations(path: string): Record<string, Operation> {
	const item = spec.paths[path];
	expect(item, `${path} is missing from the spec`).toBeDefined();
	return Object.fromEntries(
		Object.entries(item ?? {}).filter(([method]) => method !== "parameters")
	);
}

function schema(name: string): {
	properties: Record<string, unknown>;
	required?: string[];
} {
	const found = spec.components.schemas[name];
	expect(found, `${name} is missing from the spec`).toBeDefined();
	return found ?? { properties: {} };
}

function interfaceFields(source: string, name: string): string[] {
	const body = new RegExp(`interface ${name} \\{([^}]*)\\}`).exec(source)?.[1];
	if (body === undefined) throw new Error(`No interface ${name}`);
	return [...body.matchAll(/^\s*(\w+)\??:/gm)].map((match) => match[1] ?? "");
}

describe("the terminal API spec matches the routes that serve it", () => {
	test("documents the complete HTTP surface and no compatibility route", () => {
		expect(
			Object.fromEntries(
				Object.keys(spec.paths).map((path) => [
					path,
					Object.keys(operations(path)).sort()
				])
			)
		).toEqual({
			[collection]: ["get", "post"],
			[member]: ["delete", "get", "patch"],
			[`${member}/buffer`]: ["get"],
			[`${member}/clear`]: ["post"],
			[`${member}/input`]: ["post"],
			[`${member}/signal`]: ["post"]
		});
		expect(terminals).not.toContain('"/exec"');
		expect(docs).not.toContain("/api/v1/exec");
	});

	test("documents every status the routes can answer with, and no others", () => {
		// Explicit `res.status(N)` plus the two the create route carries on a
		// resolved response object. A status the routes gained and the spec never
		// learned is the drift this exists to catch, so it reads both directions.
		const returned = new Set<string>();
		for (const match of `${terminals}\n${auth}\n${index}`.matchAll(
			/res\.status\((\d{3})\)|status:\s*(\d{3})/g
		)) {
			returned.add(match[1] ?? match[2] ?? "");
		}

		const documented = new Set(
			Object.keys(spec.paths).flatMap((path) =>
				Object.values(operations(path)).flatMap((operation) =>
					Object.keys(operation.responses)
				)
			)
		);

		expect([...documented].sort()).toEqual([...returned].sort());
	});

	test("each route documents the status it answers with when it succeeds", () => {
		const success = Object.fromEntries(
			Object.keys(spec.paths).map((path) => [
				path,
				Object.entries(operations(path))
					.map(
						([method, operation]) =>
							`${method}:${Object.keys(operation.responses)
								.filter((status) => status.startsWith("2"))
								.sort()
								.join(",")}`
					)
					.sort()
			])
		);

		expect(success).toEqual({
			[collection]: ["get:200", "post:200,201"],
			[member]: ["delete:204", "get:200", "patch:200"],
			[`${member}/buffer`]: ["get:200"],
			[`${member}/clear`]: ["post:204"],
			[`${member}/input`]: ["post:204"],
			[`${member}/signal`]: ["post:204"]
		});
	});

	test("the create body is the body the handler resolves", () => {
		expect(Object.keys(schema("TerminalCreate").properties)).toEqual(
			interfaceFields(terminals, "CreateTerminalBody")
		);
		expect(terminals).toContain("hidden: body.hidden ?? false");
		expect(terminals).toContain("hideFromUser: create.hidden");
	});

	test("one-shot output is the raw merged pty stream", () => {
		const fields = interfaceFields(terminals, "WaitResult");
		expect(Object.keys(schema("WaitResult").properties)).toEqual(fields);
		expect(schema("WaitResult").required).toEqual(fields);
		expect(fields).toEqual(["output", "exit_code", "timed_out", "truncated"]);
		// A pty merges the streams; separate ones cannot be reported honestly.
		expect(terminals).not.toMatch(/\bstdout\b|\bstderr\b/);
	});

	test("terminal details and patch fields match their schemas", () => {
		const detailFields = interfaceFields(terminals, "TerminalDetails");
		expect(Object.keys(schema("Terminal").properties)).toEqual(detailFields);
		expect(schema("Terminal").required).toEqual(detailFields);
		expect(Object.keys(schema("TerminalPatch").properties)).toEqual(
			interfaceFields(terminals, "PatchTerminalBody")
		);
	});

	test("the page renders every operation the spec defines", () => {
		// The spec is only documentation once something renders it. An operation
		// added here and never placed on the page is documented to nobody, and the
		// page cannot say so - it just quietly lacks a section.
		const rendered = [
			...docs.matchAll(/<APIOperation path="([^"]+)" method="(\w+)" \/>/g)
		]
			.map((match) => `${match[2]} ${match[1]}`)
			.sort();
		const defined = Object.keys(spec.paths)
			.flatMap((path) =>
				Object.keys(operations(path)).map((method) => `${method} ${path}`)
			)
			.sort();

		expect(rendered).toEqual(defined);
		// OpenAPI cannot describe the websocket, so prose carries it instead.
		expect(docs).toContain(`WS ${collection}/{id}`);
	});

	test("the idempotency header is read by the create route", () => {
		const header = operations(collection).post?.parameters?.find(
			(parameter) => parameter.in === "header"
		);
		expect(header?.name).toBe("Idempotency-Key");
		expect(terminals).toContain(`req.headers["${header?.name.toLowerCase()}"]`);
	});

	test("the documented auth headers are the headers that authenticate", () => {
		const schemes = spec.components.securitySchemes;
		const bearer = Object.values(schemes).find(
			(scheme) => scheme.type === "http"
		);
		const apiKey = Object.values(schemes).find(
			(scheme) => scheme.type === "apiKey"
		);
		expect(auth.toLowerCase()).toContain(`startswith("${bearer?.scheme} ")`);
		expect(auth).toContain(`headers["${apiKey?.name?.toLowerCase()}"]`);
	});

	test("one limiter covers waited and websocket terminal streams", () => {
		expect(config).toContain('maxSessions: int("COMPOSERY_API_MAX_SESSIONS"');
		expect(config).toContain("COMPOSERY_API_TERMINAL_TIMEOUT");
		expect(config).toContain("COMPOSERY_API_TERMINAL_MAX_OUTPUT");
		expect(config).not.toContain("API_EXEC");
		expect(rateLimit).toContain(
			"export const sessions = new SlotLimiter(apiConfig.maxSessions)"
		);
		expect(terminals.match(/sessions\.tryAcquire/g)).toHaveLength(2);
	});

	test("every COMPOSERY_API_ variable the routes read is documented", () => {
		// docs/configuration.md is the canonical list. A variable the code reads
		// and the table never names is one nobody can discover.
		const read = new Set(
			[...`${config}\n${terminals}`.matchAll(/"(COMPOSERY_API_[A-Z_]+)"/g)].map(
				(match) => match[1] ?? ""
			)
		);
		const documented = readRepoFile("docs/configuration.md");
		expect(read.size).toBeGreaterThan(0);
		for (const name of read) {
			expect(documented, `configuration.md is missing ${name}`).toContain(
				`\`${name}\``
			);
		}
	});
});
