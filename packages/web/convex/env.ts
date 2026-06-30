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

export function websiteOrigin() {
	return requiredEnv("WEBSITE_ORIGIN").replace(/\/+$/g, "");
}

export { normalizeDomain as normalizeDomainValue };
