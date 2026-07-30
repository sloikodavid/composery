import { afterEach, describe, expect, test } from "vitest";
import {
	cloudUrl,
	ideUrl,
	normalizeDomain,
	optionalEnv,
	requiredEnv,
	runtimeDomain,
	websiteOrigin
} from "@/convex/env";

const names = ["CLOUD_DOMAIN", "WEBSITE_ORIGIN", "OPTIONAL_TEST"];
const previous = new Map(names.map((name) => [name, process.env[name]]));

afterEach(() => {
	for (const name of names) {
		const value = previous.get(name);
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

describe("normalizeDomain", () => {
	test("strips leading and trailing dots", () => {
		expect(normalizeDomain("composery.cloud")).toBe("composery.cloud");
		expect(normalizeDomain(".composery.cloud.")).toBe("composery.cloud");
		expect(normalizeDomain("...composery.cloud...")).toBe("composery.cloud");
	});
});

describe("requiredEnv", () => {
	test("returns the value when set", () => {
		process.env.CLOUD_DOMAIN = "composery.cloud";
		expect(requiredEnv("CLOUD_DOMAIN")).toBe("composery.cloud");
	});

	test("throws naming the missing variable when unset or empty", () => {
		delete process.env.CLOUD_DOMAIN;
		expect(() => requiredEnv("CLOUD_DOMAIN")).toThrow(
			"Missing Convex environment variable: CLOUD_DOMAIN"
		);
		process.env.CLOUD_DOMAIN = "";
		expect(() => requiredEnv("CLOUD_DOMAIN")).toThrow();
	});
});

describe("optionalEnv", () => {
	test("returns undefined for unset, empty, or whitespace-only values", () => {
		delete process.env.OPTIONAL_TEST;
		expect(optionalEnv("OPTIONAL_TEST")).toBeUndefined();
		process.env.OPTIONAL_TEST = "";
		expect(optionalEnv("OPTIONAL_TEST")).toBeUndefined();
		process.env.OPTIONAL_TEST = "   ";
		expect(optionalEnv("OPTIONAL_TEST")).toBeUndefined();
	});

	test("trims and returns a present value", () => {
		process.env.OPTIONAL_TEST = "  value  ";
		expect(optionalEnv("OPTIONAL_TEST")).toBe("value");
	});
});

describe("domain + url builders", () => {
	test("joins a slug onto the normalized cloud domain", () => {
		process.env.CLOUD_DOMAIN = ".composery.cloud.";
		expect(runtimeDomain("my-box")).toBe("my-box.composery.cloud");
		expect(cloudUrl("my-box")).toBe("https://my-box.composery.cloud/");
		expect(ideUrl("my-box")).toBe("https://my-box.composery.cloud/ide/");
	});

	test("strips trailing slashes from the website origin", () => {
		process.env.WEBSITE_ORIGIN = "https://www.composery.io///";
		expect(websiteOrigin()).toBe("https://www.composery.io");
	});
});
