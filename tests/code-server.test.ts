import { describe, expect, test } from "vitest";

function toBrowserAddress(address: string): URL {
	const url = new URL(address);
	if (url.hostname === "0.0.0.0") {
		url.hostname = "localhost";
	}
	return url;
}

describe("code-server browser URL", () => {
	test("rewrites wildcard bind addresses to localhost", () => {
		const url = toBrowserAddress("http://0.0.0.0:8080");

		expect(url.toString()).toBe("http://localhost:8080/");
	});
});
