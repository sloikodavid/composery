import { IDE_PATH } from "shared";

// Every environment variable the Convex plane reads, declared once.
//
// This list is the plane's environment surface, not a description of it: the
// readers below only accept a name from it, so a variable can be read here and
// nowhere else, and `tests/invariants/convex/envExample.test.ts` compares this
// array against `.env.example.convex.*` directly. That replaces a scanner that
// went looking for `process.env.X` spellings across the source and could only
// find the ones written as literals - which is how the four `POLAR_BOX_*` ids
// stayed on the checklist by accident, matched through a tolerant read in
// `billing/polar.ts` rather than through the table that actually names them.
//
// Add a variable here and to both example files, with a comment there saying
// where the value comes from. Nothing else enumerates them.
export const CONVEX_ENV_NAMES = [
	// Clerk
	"CLERK_FRONTEND_API_URL",
	"CLERK_WEBHOOK_SIGNING_SECRET",
	// Domains
	"WEBSITE_ORIGIN",
	"CLOUD_DOMAIN",
	// Polar
	"POLAR_ORGANIZATION_TOKEN",
	"POLAR_WEBHOOK_SECRET",
	"POLAR_BOX_AIR_MONTHLY_PRODUCT_ID",
	"POLAR_BOX_AIR_ANNUAL_PRODUCT_ID",
	"POLAR_BOX_PRO_MONTHLY_PRODUCT_ID",
	"POLAR_BOX_PRO_ANNUAL_PRODUCT_ID",
	"POLAR_ENVIRONMENT",
	// Hetzner
	"HETZNER_CLOUD_TOKEN",
	"HETZNER_BOX_LOCATIONS",
	"HETZNER_BOX_IMAGE",
	"HETZNER_SSH_KEYS",
	"HETZNER_FIREWALL_ID",
	"HETZNER_NETWORK_ID",
	// Cloudflare
	"CLOUDFLARE_DNS_TOKEN",
	"CLOUDFLARE_ZONE_ID",
	// Runtime container
	"RUNTIME_IMAGE",
	"RUNTIME_PORT",
	// Box SSH access
	"SSH_USER",
	"SSH_PRIVATE_KEY",
	// Resend
	"RESEND_API_KEY",
	"RESEND_WEBHOOK_SECRET",
	"ALERT_EMAIL_FROM",
	"OWNER_EMAIL_FROM"
] as const;

export type ConvexEnvName = (typeof CONVEX_ENV_NAMES)[number];

export function normalizeDomain(value: string) {
	return value.replace(/^\.+|\.+$/g, "");
}

export function requiredEnv(name: ConvexEnvName) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing Convex environment variable: ${name}.`);
	return value;
}

export function optionalEnv(name: ConvexEnvName) {
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

// Where an alert sends the person reading it. Degrades to naming the page rather
// than dropping the sentence, for the same reason as `optionalWebsiteUrl`: a
// deployment missing its origin should lose the link, not the alert.
export function staffConsoleUrl(path = "/console") {
	return optionalWebsiteUrl(path) ?? `the staff console (${path})`;
}
