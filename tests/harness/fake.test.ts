import { expect, test } from "bun:test";
import { createContractChecker } from "../../contracts/check";
import type { Contract } from "../../contracts/openapi";
import { startFake } from "../../harness/fake";

const contract = {
	sources: [
		{
			source: "https://example.com/contract",
			readAt: "2026-09-21",
			digest: "example",
			holder: "paths",
			document: {
				openapi: "3.1.2",
				paths: {
					"/thing": {
						get: {
							parameters: [],
							responses: {
								"204": { description: "No body" },
								"200": {
									content: {
										"application/json": {
											schema: {
												type: "object",
												required: ["value"],
												properties: { value: { type: "string" } },
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	],
} satisfies Contract;
const thingPath = /^\/thing$/;
const noContent = 204;

function createChecker() {
	return createContractChecker({ system: "Example", contract, waivers: [] });
}

test("a bodyless reply is checked as the empty body sent on the wire", async () => {
	const fake = await startFake({
		system: "Example",
		checker: createChecker(),
		answer: () => ({ status: noContent, body: null }),
	});
	try {
		const reply = await fetch(`${fake.url}/thing`);
		expect(await reply.text()).toBe("");
		expect(fake.problems()).toEqual([]);
	} finally {
		await fake.stop();
	}
});

test("scripted replies still pass through the contract oracle", async () => {
	const fake = await startFake({
		system: "Example",
		checker: createChecker(),
		answer: () => ({ status: 200, body: { value: "ok" } }),
	});
	const fired = fake.scriptOnce(
		{ method: "GET", path: thingPath },
		{ kind: "reply", reply: { status: 200, body: {} } },
	);
	try {
		await fetch(`${fake.url}/v1/thing`);
		expect(fired()).toBe(true);
		expect(fake.problems()).toContain(
			"GET /thing 200.value must have required property 'value'",
		);
	} finally {
		await fake.stop();
	}
});

test("a lost reply is checked before the connection is closed", async () => {
	const fake = await startFake({
		system: "Example",
		checker: createChecker(),
		answer: () => ({ status: 200, body: {} }),
	});
	const fired = fake.scriptOnce(
		{ method: "GET", path: thingPath },
		{ kind: "lose" },
	);
	try {
		await expect(fetch(`${fake.url}/v1/thing`)).rejects.toThrow();
		expect(fired()).toBe(true);
		expect(fake.problems()).toContain(
			"GET /thing 200.value must have required property 'value'",
		);
	} finally {
		await fake.stop();
	}
});
