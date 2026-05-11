import { readFileSync } from "node:fs";

export type AgentboxProtocol = "http" | "https";

export interface AgentboxConfig {
	readonly port: number;
	readonly bindAddress: string;
	readonly volumePath: string;
	readonly basePath: string;
	readonly publicUrl: string;
	readonly publicProxyUrlTemplate: string;
	readonly proxyDomain?: string;
	readonly trustedProxyHops: number;
	readonly enableMetrics: boolean;
	readonly tlsKeyPath?: string;
	readonly tlsCertPath?: string;
	readonly tlsKey?: string;
	readonly tlsCert?: string;
	readonly buildVersion: string;
	readonly buildRevision: string;
	readonly buildSource: string;
}

export interface ParseConfigOptions {
	readonly loadTlsFiles?: boolean;
}

const DEFAULT_PORT = 8080;
const DEFAULT_BUILD_SOURCE = "https://github.com/sloikodavid/agentbox";
const DEFAULT_PUBLIC_PROXY_URL_TEMPLATE = "./proxy/{{port}}";
const BOOLEAN_TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const BOOLEAN_FALSE_VALUES = new Set(["0", "false", "no", "off"]);

export class ConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigError";
	}
}

export function parseConfig(
	env: NodeJS.ProcessEnv = process.env,
	options: ParseConfigOptions = {},
): AgentboxConfig {
	const port = parsePort(env.PORT);
	const bindAddress = env.AGENTBOX_BIND_ADDRESS?.trim() || "::";
	const volumePath = env.AGENTBOX_VOLUME_PATH?.trim() || "/data";
	const trustedProxyHops = parseNonNegativeInteger(
		env.AGENTBOX_TRUSTED_PROXY_HOPS,
		"AGENTBOX_TRUSTED_PROXY_HOPS",
		0,
	);
	const enableMetrics = parseBoolean(
		env.AGENTBOX_ENABLE_METRICS,
		"AGENTBOX_ENABLE_METRICS",
	);
	const tlsKeyPath = emptyToUndefined(env.AGENTBOX_TLS_KEY_PATH);
	const tlsCertPath = emptyToUndefined(env.AGENTBOX_TLS_CERT_PATH);
	const listenerProtocol: AgentboxProtocol =
		tlsKeyPath && tlsCertPath ? "https" : "http";

	if (!volumePath.startsWith("/")) {
		throw new ConfigError(
			"AGENTBOX_VOLUME_PATH must be an absolute filesystem path",
		);
	}
	if (volumePath === "/") {
		throw new ConfigError(
			"AGENTBOX_VOLUME_PATH must not be the filesystem root",
		);
	}

	if (Boolean(tlsKeyPath) !== Boolean(tlsCertPath)) {
		throw new ConfigError(
			"AGENTBOX_TLS_KEY_PATH and AGENTBOX_TLS_CERT_PATH must be set together",
		);
	}

	const publicUrl = parsePublicUrl(env.AGENTBOX_PUBLIC_URL, {
		protocol: listenerProtocol,
		port,
	});
	const basePath = normalizeUrlPath(
		new URL(publicUrl).pathname,
		"AGENTBOX_PUBLIC_URL pathname",
	);
	const { publicProxyUrlTemplate, proxyDomain } = parsePublicProxyUrlTemplate(
		env.AGENTBOX_PUBLIC_PROXY_URL_TEMPLATE,
	);
	const loadTlsFiles = options.loadTlsFiles ?? true;

	return {
		port,
		bindAddress,
		volumePath,
		basePath,
		publicUrl,
		publicProxyUrlTemplate,
		...(proxyDomain ? { proxyDomain } : {}),
		trustedProxyHops,
		enableMetrics,
		...(tlsKeyPath
			? {
					tlsKeyPath,
					...(loadTlsFiles ? { tlsKey: readFileSync(tlsKeyPath, "utf8") } : {}),
				}
			: {}),
		...(tlsCertPath
			? {
					tlsCertPath,
					...(loadTlsFiles
						? { tlsCert: readFileSync(tlsCertPath, "utf8") }
						: {}),
				}
			: {}),
		buildVersion: env.AGENTBOX_BUILD_VERSION?.trim() || "unknown",
		buildRevision: env.AGENTBOX_BUILD_REVISION?.trim() || "unknown",
		buildSource: env.AGENTBOX_BUILD_SOURCE?.trim() || DEFAULT_BUILD_SOURCE,
	};
}

export function normalizeUrlPath(
	value: string | undefined,
	name: string,
): string {
	const raw = value?.trim();
	if (!raw || raw === "/") {
		return "/";
	}

	let path = raw.startsWith("/") ? raw : `/${raw}`;
	while (path.length > 1 && path.endsWith("/")) {
		path = path.slice(0, -1);
	}

	if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
		throw new ConfigError(`${name} must be a URL path`);
	}

	return path;
}

function parsePort(value: string | undefined): number {
	const trimmed = emptyToUndefined(value);
	if (!trimmed) {
		return DEFAULT_PORT;
	}
	if (!/^\d+$/.test(trimmed)) {
		throw new ConfigError("PORT must be an integer between 1 and 65535");
	}
	const parsed = Number(trimmed);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
		throw new ConfigError("PORT must be an integer between 1 and 65535");
	}
	return parsed;
}

function parseNonNegativeInteger(
	value: string | undefined,
	name: string,
	fallback: number,
): number {
	const trimmed = emptyToUndefined(value);
	if (!trimmed) {
		return fallback;
	}
	if (!/^\d+$/.test(trimmed)) {
		throw new ConfigError(`${name} must be a non-negative integer`);
	}
	const parsed = Number(trimmed);
	if (!Number.isSafeInteger(parsed)) {
		throw new ConfigError(`${name} must be a non-negative integer`);
	}
	return parsed;
}

function parseBoolean(value: string | undefined, name: string): boolean {
	const trimmed = emptyToUndefined(value)?.toLowerCase();
	if (!trimmed) {
		return false;
	}
	if (BOOLEAN_TRUE_VALUES.has(trimmed)) {
		return true;
	}
	if (BOOLEAN_FALSE_VALUES.has(trimmed)) {
		return false;
	}
	throw new ConfigError(
		`${name} must be a boolean (1/0, true/false, yes/no, on/off)`,
	);
}

function emptyToUndefined(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function parsePublicUrl(
	value: string | undefined,
	fallback: { readonly protocol: AgentboxProtocol; readonly port: number },
): string {
	const trimmed = emptyToUndefined(value);
	if (!trimmed) {
		return deriveLocalPublicUrl(fallback);
	}

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new ConfigError("AGENTBOX_PUBLIC_URL must be a valid absolute URL");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new ConfigError("AGENTBOX_PUBLIC_URL must use http or https");
	}
	if (url.username || url.password) {
		throw new ConfigError("AGENTBOX_PUBLIC_URL must not include credentials");
	}
	if (url.search || url.hash) {
		throw new ConfigError(
			"AGENTBOX_PUBLIC_URL must not include query or fragment",
		);
	}

	while (url.pathname.length > 1 && url.pathname.endsWith("/")) {
		url.pathname = url.pathname.slice(0, -1);
	}

	return url.toString().replace(/\/$/, "");
}

function deriveLocalPublicUrl(input: {
	readonly protocol: AgentboxProtocol;
	readonly port: number;
}): string {
	const isDefaultPort =
		(input.protocol === "http" && input.port === 80) ||
		(input.protocol === "https" && input.port === 443);
	const port = isDefaultPort ? "" : `:${input.port}`;
	return `${input.protocol}://localhost${port}`;
}

function parsePublicProxyUrlTemplate(value: string | undefined): {
	readonly publicProxyUrlTemplate: string;
	readonly proxyDomain?: string;
} {
	const trimmed = value?.trim();
	if (!trimmed) {
		return { publicProxyUrlTemplate: DEFAULT_PUBLIC_PROXY_URL_TEMPLATE };
	}
	if (!trimmed.includes("{{port}}")) {
		throw new ConfigError(
			"AGENTBOX_PUBLIC_PROXY_URL_TEMPLATE must include {{port}}",
		);
	}
	if (trimmed.startsWith("/")) {
		throw new ConfigError(
			"AGENTBOX_PUBLIC_PROXY_URL_TEMPLATE must be relative or an absolute http/https URL",
		);
	}
	if (trimmed.startsWith("./")) {
		return { publicProxyUrlTemplate: trimmed };
	}

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new ConfigError(
			"AGENTBOX_PUBLIC_PROXY_URL_TEMPLATE must be relative or an absolute http/https URL",
		);
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new ConfigError(
			"AGENTBOX_PUBLIC_PROXY_URL_TEMPLATE must use http or https",
		);
	}
	if (!url.hostname.includes("{{port}}")) {
		return { publicProxyUrlTemplate: trimmed };
	}
	const proxyDomain = proxyDomainFromHostname(url.hostname);
	return proxyDomain
		? { publicProxyUrlTemplate: trimmed, proxyDomain }
		: { publicProxyUrlTemplate: trimmed };
}

function proxyDomainFromHostname(hostname: string): string | undefined {
	const prefix = "{{port}}.";
	if (!hostname.startsWith(prefix)) {
		return undefined;
	}
	const domain = hostname.slice(prefix.length);
	return domain ? domain : undefined;
}
