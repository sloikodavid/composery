import { describe, expect, test, vi } from "vitest";

import {
	checkDeployment,
	compareNames,
	envNames,
	formatResult,
	isBuildName,
	listConvexNames,
	main,
	nameLines
} from "../../../scripts/env.mjs";

const FILES = new Map([
	[".env.example.next.prod", "EXPECTED=\nSHARED="],
	[".env.example.convex.prod", "CONVEX_EXPECTED="]
]);
const read = (file: string) => FILES.get(file) as string;

describe("deployment environment check", () => {
	test("parsing rejects malformed and duplicate names", () => {
		expect(envNames("# comment\nONE=\nTWO=value", "good.env")).toEqual(
			new Set(["ONE", "TWO"])
		);
		expect(() => envNames("", "empty.env")).toThrow(
			"empty.env contains no variables"
		);
		expect(() => envNames("not an assignment", "bad.env")).toThrow(
			"bad.env:1 is not a NAME=value line"
		);
		expect(() => envNames("ONE=\nONE=", "repeat.env")).toThrow(
			"repeat.env:2 repeats ONE"
		);

		expect(nameLines("ONE\nTWO\n", "names")).toEqual(new Set(["ONE", "TWO"]));
		expect(() => nameLines("ONE=value", "names")).toThrow(
			"names:1 is not an environment name"
		);
		expect(() => nameLines("ONE\nONE", "names")).toThrow("names:2 repeats ONE");
	});

	test("comparison separates blocking missing names from log-only additions", () => {
		expect(
			compareNames({
				expected: new Set(["MISSING", "PRESENT"]),
				actual: new Set(["PRESENT", "EXTRA", "MANAGED"]),
				ignore: (name) => name === "MANAGED"
			})
		).toEqual({ missing: ["MISSING"], extra: ["EXTRA"] });
	});

	test("Vercel infrastructure names are not application drift", () => {
		for (const name of [
			"CI",
			"PATH",
			"VERCEL",
			"VERCEL_ENV",
			"NEXT_PUBLIC_VERCEL_ENV",
			"npm_config_user_agent"
		]) {
			expect(isBuildName(name), name).toBe(true);
		}
		expect(isBuildName("UNEXPECTED_APPLICATION_NAME")).toBe(false);
	});

	test("checks Vercel property names without invoking value getters", () => {
		const environment = {};
		for (const name of ["EXPECTED", "SHARED", "UNEXPECTED"]) {
			Object.defineProperty(environment, name, {
				enumerable: true,
				get: () => {
					throw new Error("value was read");
				}
			});
		}

		expect(
			checkDeployment({
				environment,
				convexNames: new Set(["CONVEX_EXPECTED", "CONVEX_EXTRA"]),
				read
			})
		).toEqual([
			{
				name: "Vercel Production",
				example: ".env.example.next.prod",
				missing: [],
				extra: ["UNEXPECTED"]
			},
			{
				name: "Convex Production",
				example: ".env.example.convex.prod",
				missing: [],
				extra: ["CONVEX_EXTRA"]
			}
		]);
	});

	test("Convex name listing asks for names only", () => {
		const run = vi.fn(() => ({
			status: 0,
			stdout: "ONE\nTWO\n"
		}));

		expect(listConvexNames({ run })).toEqual(new Set(["ONE", "TWO"]));
		expect(run).toHaveBeenCalledWith(
			process.execPath,
			expect.arrayContaining(["env", "list", "--names-only"]),
			expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] })
		);
	});

	test("a failed Convex name listing blocks without printing command output", () => {
		const run = vi.fn(() => ({
			status: 1,
			stdout: "SECRET=value",
			stderr: "SECRET=value"
		}));

		expect(() => listConvexNames({ run })).toThrow(
			"[env] Convex environment names could not be listed; deployment blocked."
		);
	});

	test("missing names block while additional names only log", () => {
		const write = vi.fn();
		const writeError = vi.fn();
		const blocked = main({
			environment: { EXPECTED: undefined },
			convexNames: new Set(["CONVEX_EXPECTED"]),
			read,
			write,
			writeError
		});

		expect(blocked.blocked).toBe(true);
		expect(writeError).toHaveBeenCalledWith(
			"[env] Vercel Production — missing required names: SHARED. Deployment blocked. Values were not read."
		);

		const additionalOnly = main({
			environment: {
				EXPECTED: undefined,
				SHARED: undefined,
				EXTRA: undefined
			},
			convexNames: new Set(["CONVEX_EXPECTED", "CONVEX_EXTRA"]),
			read,
			write,
			writeError
		});
		expect(additionalOnly.blocked).toBe(false);
		expect(writeError).toHaveBeenCalledWith(
			"[env] Vercel Production — additional names (drift): EXTRA. Deployment continues. Values were not read."
		);
		expect(writeError).toHaveBeenCalledWith(
			"[env] Convex Production — additional names (drift): CONVEX_EXTRA. Deployment continues. Values were not read."
		);
	});

	test("formats a clean plane explicitly", () => {
		expect(
			formatResult({
				name: "Convex Production",
				example: ".env.example.convex.prod",
				missing: [],
				extra: []
			})
		).toBe(
			"[env] Convex Production matches .env.example.convex.prod. Values were not read."
		);
	});
});
