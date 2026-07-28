import { afterAll, describe, expect, test } from "vitest";
import { isBoxIdeRedirect } from "@/convex/boxes/auth";

const previousDomain = process.env.CLOUD_DOMAIN;

describe("isBoxIdeRedirect", () => {
	test("accepts an HTTPS callback supplied by the matching box IDE", () => {
		process.env.CLOUD_DOMAIN = "composery.cloud";
		expect(
			isBoxIdeRedirect(
				{ slug: "my-box" },
				"https://my-box.composery.cloud/ide/_composery/cloud/callback"
			)
		).toBe(true);
	});

	test.each([
		"https://other.composery.cloud/ide/_composery/cloud/callback",
		"https://my-box.composery.cloud/_composery/cloud/callback",
		"https://my-box.composery.cloud/ide/callback?send=elsewhere",
		"not a url"
	])("rejects a callback outside the box IDE: %s", (redirectUri) => {
		process.env.CLOUD_DOMAIN = "composery.cloud";
		expect(isBoxIdeRedirect({ slug: "my-box" }, redirectUri)).toBe(false);
	});
});

afterAll(() => {
	if (previousDomain === undefined) delete process.env.CLOUD_DOMAIN;
	else process.env.CLOUD_DOMAIN = previousDomain;
});
