import { describe, expect, test } from "vitest";

import { normalizeInstanceUrl } from "@/lib/normalize-url";

describe("normalizeInstanceUrl", () => {
	test("prepends https:// to a bare host", () => {
		expect(normalizeInstanceUrl("mybox.com").href).toBe(
			"https://mybox.com/ide/"
		);
	});

	test("preserves a folder query param", () => {
		expect(normalizeInstanceUrl("https://mybox.com/?folder=/app").href).toBe(
			"https://mybox.com/ide/?folder=/app"
		);
	});

	test("accepts http with a port", () => {
		expect(normalizeInstanceUrl("http://localhost:8080").href).toBe(
			"http://localhost:8080/ide/"
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
		).toBe("https://host/ide/?workspace=/home/user/ws");
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
			"https://mybox.com/ide/"
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

	describe("bare local host defaults to http", () => {
		test.each([
			["localhost", "http://localhost/ide/"],
			["localhost:8080", "http://localhost:8080/ide/"],
			["localhost:8080/code/", "http://localhost:8080/code/"],
			["127.0.0.1", "http://127.0.0.1/ide/"],
			["192.168.1.5", "http://192.168.1.5/ide/"],
			["10.0.0.1:3000", "http://10.0.0.1:3000/ide/"],
			["172.16.0.1", "http://172.16.0.1/ide/"],
			["172.31.255.255", "http://172.31.255.255/ide/"],
			["169.254.1.1", "http://169.254.1.1/ide/"],
			["raspberrypi.local", "http://raspberrypi.local/ide/"],
			["nas", "http://nas/ide/"],
			[
				"192.168.1.5:8080/code/?folder=/app",
				"http://192.168.1.5:8080/code/?folder=/app"
			]
		])("%p -> %p", (input, expected) => {
			expect(normalizeInstanceUrl(input).href).toBe(expected);
		});
	});

	describe("bare public host defaults to https", () => {
		test.each([
			["mybox.com", "https://mybox.com/ide/"],
			["8.8.8.8", "https://8.8.8.8/ide/"],
			["172.32.0.1", "https://172.32.0.1/ide/"], // outside the 172.16/12 range
			["169.253.0.1", "https://169.253.0.1/ide/"] // outside link-local
		])("%p -> %p", (input, expected) => {
			expect(normalizeInstanceUrl(input).href).toBe(expected);
		});
	});

	describe("an explicit secure scheme is honored", () => {
		test("explicit https on a LAN host stays https", () => {
			expect(normalizeInstanceUrl("https://192.168.1.5").href).toBe(
				"https://192.168.1.5/ide/"
			);
		});

		test("explicit http on a public host is rejected", () => {
			expect(() => normalizeInstanceUrl("http://mybox.com")).toThrow(
				"Public instances must use HTTPS"
			);
		});
	});

	test("rejects an empty string", () => {
		expect(() => normalizeInstanceUrl("")).toThrow();
		expect(() => normalizeInstanceUrl("   ")).toThrow();
	});
});
