import { describe, expect, test } from "vitest";
import {
	ConfigError,
	normalizeUrlPath,
	parseConfig,
} from "../rootfs/opt/agentbox/config.ts";

describe("normalizeUrlPath", () => {
	test("normalizes empty and root paths", () => {
		expect(normalizeUrlPath(undefined, "TEST")).toBe("/");
		expect(normalizeUrlPath("", "TEST")).toBe("/");
		expect(normalizeUrlPath("/", "TEST")).toBe("/");
	});

	test("adds a leading slash and removes trailing slash", () => {
		expect(normalizeUrlPath("agentbox", "TEST")).toBe("/agentbox");
		expect(normalizeUrlPath("/agentbox/", "TEST")).toBe("/agentbox");
	});
});

describe("parseConfig", () => {
	test("uses defaults", () => {
		const config = parseConfig({});
		expect(config.port).toBe(8080);
		expect(config.bindAddress).toBe("::");
		expect(config.volumePath).toBe("/data");
		expect(config.basePath).toBe("/");
		expect(config.publicUrl).toBe("http://localhost:8080");
		expect(config.publicProxyUrlTemplate).toBe("./proxy/{{port}}");
	});

	test("rejects invalid port", () => {
		expect(() => parseConfig({ PORT: "123abc" })).toThrow(ConfigError);
		expect(() => parseConfig({ PORT: "0" })).toThrow(ConfigError);
	});

	test("derives base path from public URL", () => {
		const config = parseConfig({
			AGENTBOX_PUBLIC_URL: "https://example.com/box/",
		});
		expect(config.publicUrl).toBe("https://example.com/box");
		expect(config.basePath).toBe("/box");
	});

	test("defaults public URL to https when TLS files are configured", () => {
		const config = parseConfig(
			{
				AGENTBOX_TLS_KEY_PATH: "missing-key.pem",
				AGENTBOX_TLS_CERT_PATH: "missing-cert.pem",
				PORT: "443",
			},
			{ loadTlsFiles: false },
		);
		expect(config.publicUrl).toBe("https://localhost");
	});

	test("accepts a host-based public proxy URL template and derives proxy domain", () => {
		const config = parseConfig({
			AGENTBOX_PUBLIC_PROXY_URL_TEMPLATE: "https://{{port}}.box.example.com",
		});
		expect(config.publicProxyUrlTemplate).toBe(
			"https://{{port}}.box.example.com",
		);
		expect(config.proxyDomain).toBe("box.example.com");
	});

	test("accepts a relative public proxy URL template", () => {
		const config = parseConfig({
			AGENTBOX_PUBLIC_PROXY_URL_TEMPLATE: "./ports/{{port}}",
		});
		expect(config.publicProxyUrlTemplate).toBe("./ports/{{port}}");
		expect(config.proxyDomain).toBeUndefined();
	});

	test("rejects ambiguous public proxy URL templates", () => {
		expect(() =>
			parseConfig({
				AGENTBOX_PUBLIC_PROXY_URL_TEMPLATE: "https://ports.example.com",
			}),
		).toThrow(ConfigError);
		expect(() =>
			parseConfig({
				AGENTBOX_PUBLIC_PROXY_URL_TEMPLATE: "/ports/{{port}}",
			}),
		).toThrow(ConfigError);
	});

	test("parses explicit boolean and trusted proxy hop values", () => {
		const config = parseConfig({
			AGENTBOX_ENABLE_METRICS: "yes",
			AGENTBOX_TRUSTED_PROXY_HOPS: "2",
		});
		expect(config.enableMetrics).toBe(true);
		expect(config.trustedProxyHops).toBe(2);
		expect(parseConfig({ AGENTBOX_ENABLE_METRICS: "0" }).enableMetrics).toBe(
			false,
		);
	});

	test("rejects invalid boolean and trusted proxy hop values", () => {
		expect(() => parseConfig({ AGENTBOX_ENABLE_METRICS: "maybe" })).toThrow(
			ConfigError,
		);
		expect(() => parseConfig({ AGENTBOX_TRUSTED_PROXY_HOPS: "1.5" })).toThrow(
			ConfigError,
		);
	});

	test("requires absolute volume path", () => {
		expect(() => parseConfig({ AGENTBOX_VOLUME_PATH: "data" })).toThrow(
			ConfigError,
		);
	});

	test("rejects the filesystem root as the persistence path", () => {
		expect(() => parseConfig({ AGENTBOX_VOLUME_PATH: "/" })).toThrow(
			ConfigError,
		);
	});

	test("requires TLS files to be configured together", () => {
		expect(() => parseConfig({ AGENTBOX_TLS_KEY_PATH: "key.pem" })).toThrow(
			ConfigError,
		);
		expect(() => parseConfig({ AGENTBOX_TLS_CERT_PATH: "cert.pem" })).toThrow(
			ConfigError,
		);
	});

	test("can parse TLS config without reading TLS files", () => {
		const config = parseConfig(
			{
				AGENTBOX_TLS_KEY_PATH: "missing-key.pem",
				AGENTBOX_TLS_CERT_PATH: "missing-cert.pem",
			},
			{ loadTlsFiles: false },
		);
		expect(config.tlsKeyPath).toBe("missing-key.pem");
		expect(config.tlsCertPath).toBe("missing-cert.pem");
		expect(config.tlsKey).toBeUndefined();
		expect(config.tlsCert).toBeUndefined();
	});

	test("requires public URL to be a clean http or https base URL", () => {
		expect(() =>
			parseConfig({ AGENTBOX_PUBLIC_URL: "ftp://example.com" }),
		).toThrow(ConfigError);
		expect(() =>
			parseConfig({ AGENTBOX_PUBLIC_URL: "https://user@example.com" }),
		).toThrow(ConfigError);
		expect(() =>
			parseConfig({ AGENTBOX_PUBLIC_URL: "https://example.com?debug=1" }),
		).toThrow(ConfigError);
	});
});
