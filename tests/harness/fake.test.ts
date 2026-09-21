import { expect, test } from "bun:test";
import { createContractChecker } from "../../contracts/check";
import type { Contract } from "../../contracts/schema";
import { startFake } from "../../harness/fake";

const contract = {
	sources: [],
	paths: {
		"/thing": {
			get: {
				parameters: [],
				request: {},
				responses: {
					"200": {
						type: "object",
						required: ["value"],
						properties: { value: { type: "string" } },
					},
				},
			},
		},
	},
} satisfies Contract;
const thingPath = /^\/thing$/;

function createChecker() {
	return createContractChecker({ system: "Example", contract, waivers: [] });
}

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
			"GET /thing 200.value is missing, and Example always sends it",
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
			"GET /thing 200.value is missing, and Example always sends it",
		);
	} finally {
		await fake.stop();
	}
});
