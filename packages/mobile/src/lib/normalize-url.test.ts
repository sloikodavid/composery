import { describe, expect, test } from "vitest";

import { normalizeInstanceUrl } from "./normalize-url";

describe("normalizeInstanceUrl", () => {
	test("prepends https:// to a bare host", () => {
		expect(normalizeInstanceUrl("mybox.com").href).toBe("https://mybox.com/");
	});

	test("preserves a folder query param", () => {
		expect(normalizeInstanceUrl("https://mybox.com/?folder=/app").href).toBe(
			"https://mybox.com/?folder=/app"
		);
	});

	test("accepts http with a port", () => {
		expect(normalizeInstanceUrl("http://localhost:8080").href).toBe(
			"http://localhost:8080/"
		);
	});

	test("preserves a subpath with a trailing slash", () => {
		expect(normalizeInstanceUrl("https://host/code/").href).toBe(
			"https://host/code/"
		);
	});

	test("preserves port + subpath + query together", () => {
		expect(
			normalizeInstanceUrl("https://host:8443/code/?folder=/home/user").href
		).toBe("https://host:8443/code/?folder=/home/user");
	});

	test("preserves a workspace query param", () => {
		expect(
			normalizeInstanceUrl("https://host/?workspace=/home/user/ws").href
		).toBe("https://host/?workspace=/home/user/ws");
	});

	test("preserves a hash fragment", () => {
		expect(normalizeInstanceUrl("https://host/code/#/editor").href).toBe(
			"https://host/code/#/editor"
		);
	});

	test("lowercases the host but leaves path case alone", () => {
		const url = normalizeInstanceUrl("https://MyBox.com/Path");
		expect(url.hostname).toBe("mybox.com");
		expect(url.pathname).toBe("/Path");
		expect(url.href).toBe("https://mybox.com/Path");
	});

	test("preserves /code vs /code/ (trailing slash matters)", () => {
		expect(normalizeInstanceUrl("https://host/code").href).toBe(
			"https://host/code"
		);
		expect(normalizeInstanceUrl("https://host/code/").href).toBe(
			"https://host/code/"
		);
	});

	test("collapses repeated leading slashes in the pathname to one", () => {
		expect(normalizeInstanceUrl("https://host//code/").href).toBe(
			"https://host/code/"
		);
		expect(normalizeInstanceUrl("https://host///a/b").href).toBe(
			"https://host/a/b"
		);
	});

	test("keeps internal double slashes in the pathname", () => {
		expect(normalizeInstanceUrl("https://host/a//b").href).toBe(
			"https://host/a//b"
		);
	});

	test("trims surrounding whitespace", () => {
		expect(normalizeInstanceUrl("  https://mybox.com/  ").href).toBe(
			"https://mybox.com/"
		);
	});

	test("rejects a non-http(s) scheme", () => {
		expect(() => normalizeInstanceUrl("ftp://x")).toThrow();
		expect(() => normalizeInstanceUrl("file:///etc/passwd")).toThrow();
		expect(() => normalizeInstanceUrl("composery://add")).toThrow();
	});

	test("rejects URLs containing credentials", () => {
		expect(() => normalizeInstanceUrl("https://user:pass@host/")).toThrow();
		expect(() => normalizeInstanceUrl("user:pass@host")).toThrow();
	});

	test("rejects an empty string", () => {
		expect(() => normalizeInstanceUrl("")).toThrow();
		expect(() => normalizeInstanceUrl("   ")).toThrow();
	});
});
