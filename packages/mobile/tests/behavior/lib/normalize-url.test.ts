import { assert, property } from "fast-check";
import { describe, expect, test } from "vitest";

import { normalizeInstanceUrl } from "@/lib/normalize-url";
import { instanceUrlArbitrary } from "../../support/urls";

describe("normalizeInstanceUrl", () => {
	test("is idempotent for every accepted instance URL", () => {
		assert(
			property(instanceUrlArbitrary, (input) => {
				const normalized = normalizeInstanceUrl(input).href;
				expect(normalizeInstanceUrl(normalized).href).toBe(normalized);
				expect(normalizeInstanceUrl(` \t${input}\n`).href).toBe(normalized);
			})
		);
	});

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
		for (const [input, message] of [
			["ftp://x", "Unsupported scheme: ftp:"],
			["file:///etc/passwd", "Unsupported scheme: file:"],
			["composery://add", "Unsupported scheme: composery:"]
		]) {
			expect(() => normalizeInstanceUrl(input)).toThrow(message);
		}
	});

	test("rejects URLs containing credentials", () => {
		for (const input of [
			"https://user:pass@host/",
			"https://user@host/",
			"https://:pass@host/",
			"user:pass@host"
		]) {
			expect(() => normalizeInstanceUrl(input)).toThrow(
				`URL must not contain credentials: ${input}`
			);
		}
	});

	describe("bare local host defaults to http", () => {
		test("classifies every supported loopback, private, link-local, mDNS, and LAN form", () => {
			for (const [input, expected] of [
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
				["[::1]", "http://[::1]/ide/"],
				["[fe80::1]", "http://[fe80::1]/ide/"],
				[
					"192.168.1.5:8080/code/?folder=/app",
					"http://192.168.1.5:8080/code/?folder=/app"
				]
			]) {
				expect(normalizeInstanceUrl(input).href).toBe(expected);
			}
		});
	});

	describe("bare public host defaults to https", () => {
		test("keeps every boundary outside the local ranges on HTTPS", () => {
			for (const [input, expected] of [
				["mybox.com", "https://mybox.com/ide/"],
				["8.8.8.8", "https://8.8.8.8/ide/"],
				["192.167.1.1", "https://192.167.1.1/ide/"],
				["192.169.1.1", "https://192.169.1.1/ide/"],
				["191.168.1.1", "https://191.168.1.1/ide/"],
				["172.15.255.255", "https://172.15.255.255/ide/"],
				["172.32.0.1", "https://172.32.0.1/ide/"],
				["171.16.0.1", "https://171.16.0.1/ide/"],
				["169.253.0.1", "https://169.253.0.1/ide/"],
				["169.255.0.1", "https://169.255.0.1/ide/"],
				["168.254.1.1", "https://168.254.1.1/ide/"],
				["192.168.1.example", "https://192.168.1.example/ide/"],
				["192.168.1.1.example", "https://192.168.1.1.example/ide/"],
				["[2001:4860:4860::8888]", "https://[2001:4860:4860::8888]/ide/"]
			]) {
				expect(normalizeInstanceUrl(input).href).toBe(expected);
			}
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
		expect(() => normalizeInstanceUrl("")).toThrow("Invalid URL: ");
		expect(() => normalizeInstanceUrl("   ")).toThrow("Invalid URL:    ");
		expect(() => normalizeInstanceUrl("junk https://host")).toThrow(
			"Invalid URL: junk https://host"
		);
	});
});
