import { describe, expect, test } from "vitest";

function toLocalBrowserAddress(address: string): URL {
	const url = new URL(address);
	if (url.hostname === "0.0.0.0") {
		url.hostname = "localhost";
	}
	return url;
}

describe("code-server browser URL", () => {
	test("rewrites wildcard bind addresses to localhost", () => {
		const url = toLocalBrowserAddress("http://0.0.0.0:8080");

		expect(url.toString()).toBe("http://localhost:8080/");
	});
});
