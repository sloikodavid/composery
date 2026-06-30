import { afterEach, describe, expect, it } from "vitest";
import {
	cloudUrl,
	normalizeDomainValue,
	optionalEnv,
	requiredEnv,
	runtimeDomain,
	websiteOrigin
} from "./env";

const names = ["CLOUD_DOMAIN", "WEBSITE_ORIGIN", "OPTIONAL_TEST"];
const previous = new Map(names.map((name) => [name, process.env[name]]));

afterEach(() => {
	for (const name of names) {
		const value = previous.get(name);
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

describe("normalizeDomainValue", () => {
	it("strips leading and trailing dots", () => {
		expect(normalizeDomainValue("composery.cloud")).toBe("composery.cloud");
		expect(normalizeDomainValue(".composery.cloud.")).toBe("composery.cloud");
		expect(normalizeDomainValue("...composery.cloud...")).toBe(
			"composery.cloud"
		);
	});
});

describe("requiredEnv", () => {
	it("returns the value when set", () => {
		process.env.CLOUD_DOMAIN = "composery.cloud";
		expect(requiredEnv("CLOUD_DOMAIN")).toBe("composery.cloud");
	});

	it("throws naming the missing variable when unset or empty", () => {
		delete process.env.CLOUD_DOMAIN;
		expect(() => requiredEnv("CLOUD_DOMAIN")).toThrow(
			"Missing Convex environment variable: CLOUD_DOMAIN"
		);
		process.env.CLOUD_DOMAIN = "";
		expect(() => requiredEnv("CLOUD_DOMAIN")).toThrow();
	});
});

describe("optionalEnv", () => {
	it("returns undefined for unset, empty, or whitespace-only values", () => {
		delete process.env.OPTIONAL_TEST;
		expect(optionalEnv("OPTIONAL_TEST")).toBeUndefined();
		process.env.OPTIONAL_TEST = "";
		expect(optionalEnv("OPTIONAL_TEST")).toBeUndefined();
		process.env.OPTIONAL_TEST = "   ";
		expect(optionalEnv("OPTIONAL_TEST")).toBeUndefined();
	});

	it("trims and returns a present value", () => {
		process.env.OPTIONAL_TEST = "  value  ";
		expect(optionalEnv("OPTIONAL_TEST")).toBe("value");
	});
});

describe("domain + url builders", () => {
	it("joins a slug onto the normalized cloud domain", () => {
		process.env.CLOUD_DOMAIN = ".composery.cloud.";
		expect(runtimeDomain("my-box")).toBe("my-box.composery.cloud");
		expect(cloudUrl("my-box")).toBe("https://my-box.composery.cloud/");
	});

	it("strips trailing slashes from the website origin", () => {
		process.env.WEBSITE_ORIGIN = "https://www.composery.io///";
		expect(websiteOrigin()).toBe("https://www.composery.io");
	});
});
