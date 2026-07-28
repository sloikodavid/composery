import { IDE_PATH } from "shared";

function normalizeDomain(value: string) {
	return value.replace(/^\.+|\.+$/g, "");
}

export function requiredEnv(name: string) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing Convex environment variable: ${name}.`);
	return value;
}

export function optionalEnv(name: string) {
	const value = process.env[name];
	return value && value.trim() ? value.trim() : undefined;
}

export function runtimeDomain(slug: string) {
	return `${slug}.${normalizeDomain(requiredEnv("CLOUD_DOMAIN"))}`;
}

export function cloudUrl(slug: string) {
	return `https://${runtimeDomain(slug)}/`;
}

export function ideUrl(slug: string) {
	return new URL(IDE_PATH, cloudUrl(slug)).toString();
}

export function websiteOrigin() {
	return requiredEnv("WEBSITE_ORIGIN").replace(/\/+$/g, "");
}

// A link onto the website, or `undefined` where the origin is not configured -
// the difference from `websiteOrigin` above, which throws. Both callers put a
// link inside an email sent from a box lifecycle mutation, and a deployment
// missing its origin must lose the link rather than the deletion.
export function optionalWebsiteUrl(path: string) {
	const origin = optionalEnv("WEBSITE_ORIGIN")?.replace(/\/+$/g, "");
	return origin ? `${origin}${path}` : undefined;
}

export { normalizeDomain as normalizeDomainValue };
