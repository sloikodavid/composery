export const RESERVED_BOX_SLUGS = [
	"www",
	"api",
	"app",
	"admin",
	"auth",
	"login",
	"signin",
	"signup",
	"billing",
	"status",
	"support",
	"help",
	"docs",
	"mail",
	"dashboard",
	"console",
	"portal",
	"account",
	"settings",
	"cloud",
	"box",
	"boxes",
	"workspace",
	"workspaces",
	"security",
	"trust",
	"legal",
	"privacy",
	"terms",
	"dev",
	"staging",
	"test",
	"qa",
	"prod",
	"production",
	"demo",
	"sandbox"
] as const;

const reservedBoxSlugSet = new Set<string>(RESERVED_BOX_SLUGS);

export function sanitizeSlug(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "")
		.replace(/^-+/g, "")
		.slice(0, 63);
}

export function isReservedSlug(slug: string) {
	return reservedBoxSlugSet.has(slug);
}

export function isValidSlug(slug: string) {
	return (
		slug.length >= 3 &&
		slug.length <= 63 &&
		!slug.endsWith("-") &&
		!slug.startsWith("xn--") &&
		/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) &&
		!isReservedSlug(slug)
	);
}
