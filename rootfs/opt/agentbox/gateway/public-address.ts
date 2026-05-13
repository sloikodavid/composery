import type { AgentboxConfig } from "../config.ts";

export interface PublicAddress {
	readonly baseUrlPath: string;
	readonly proxyHostnameTemplate?: string;
	readonly healthUrlPath: string;
	readonly readinessUrlPath: string;
	readonly metricsUrlPath: string;
	stripBaseUrlPath(pathname: string): string | null;
	isProxyHostname(hostHeader: string | readonly string[] | undefined): boolean;
}

export function createPublicAddress(
	config: Pick<AgentboxConfig, "publicUrl" | "publicProxyUrlTemplate">,
): PublicAddress {
	const baseUrlPath = baseUrlPathFrom(config.publicUrl);
	const proxyHostnameTemplate = proxyHostnameTemplateFrom(
		config.publicProxyUrlTemplate,
	);
	const healthUrlPath = joinPublicUrlPath(baseUrlPath, "/healthz");
	return {
		baseUrlPath,
		...(proxyHostnameTemplate ? { proxyHostnameTemplate } : {}),
		healthUrlPath,
		readinessUrlPath: joinPublicUrlPath(healthUrlPath, "/readiness"),
		metricsUrlPath: joinPublicUrlPath(baseUrlPath, "/metrics"),
		stripBaseUrlPath(pathname: string): string | null {
			return stripBaseUrlPath(pathname, baseUrlPath);
		},
		isProxyHostname(
			hostHeader: string | readonly string[] | undefined,
		): boolean {
			const host = hostWithoutPort(hostHeader)?.toLowerCase();
			return Boolean(
				host &&
				proxyHostnameTemplate &&
				proxyHostnamePattern(proxyHostnameTemplate.toLowerCase()).test(host),
			);
		},
	};
}

function baseUrlPathFrom(publicUrl: string): string {
	return normalizeUrlPath(new URL(publicUrl).pathname);
}

function proxyHostnameTemplateFrom(
	publicProxyUrlTemplate: string,
): string | undefined {
	if (publicProxyUrlTemplate.startsWith("./")) return undefined;
	const url = new URL(publicProxyUrlTemplate);
	return url.hostname.includes("{{port}}") ? url.hostname : undefined;
}

function normalizeUrlPath(value: string): string {
	let result = value.trim() || "/";
	result = result.startsWith("/") ? result : `/${result}`;
	while (result.length > 1 && result.endsWith("/")) {
		result = result.slice(0, -1);
	}
	return result;
}

function stripBaseUrlPath(
	pathname: string,
	baseUrlPath: string,
): string | null {
	if (baseUrlPath === "/") {
		return pathname;
	}
	if (pathname === baseUrlPath) {
		return "/";
	}
	if (pathname.startsWith(`${baseUrlPath}/`)) {
		return pathname.slice(baseUrlPath.length);
	}
	return null;
}

function hostWithoutPort(
	value: string | readonly string[] | undefined,
): string | null {
	const host = typeof value === "string" ? value : (value?.[0] ?? null);
	if (!host) return null;
	if (host.startsWith("[")) {
		const end = host.indexOf("]");
		return end === -1 ? host : host.slice(0, end + 1);
	}
	return host.split(":")[0] ?? null;
}

function proxyHostnamePattern(proxyHostnameTemplate: string): RegExp {
	const escaped = proxyHostnameTemplate
		.split("{{port}}")
		.map(escapeRegex)
		.join("\\d+");
	return new RegExp(`^${escaped}$`);
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function joinPublicUrlPath(baseUrlPath: string, path: string): string {
	if (baseUrlPath === "/") {
		return path;
	}
	return `${baseUrlPath}${path}`;
}
