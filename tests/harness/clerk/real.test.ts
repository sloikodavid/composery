import { afterEach, expect, test } from "bun:test";
import { getClerkSecret } from "../../../harness/clerk/real";

const namesTheSecret = /CLERK_SECRET_KEY/;
const namesTheIssuer = /CLERK_FRONTEND_API_URL/;

type Named = "CLERK_MODE" | "CLERK_SECRET_KEY" | "CLERK_FRONTEND_API_URL";

const held: Record<Named, string | undefined> = {
	// biome-ignore-start lint/style/useNamingConvention: environment variable names use CONSTANT_CASE
	CLERK_MODE: process.env.CLERK_MODE,
	CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
	CLERK_FRONTEND_API_URL: process.env.CLERK_FRONTEND_API_URL,
	// biome-ignore-end lint/style/useNamingConvention: environment variable names use CONSTANT_CASE
};

function set(name: Named, value: string | undefined) {
	if (value === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = value;
}

afterEach(() => {
	for (const [name, value] of Object.entries(held)) {
		set(name as Named, value);
	}
});

test("keeps the fake a fake while the secret sits in the file", () => {
	// Holding a secret is not an instruction to make accounts in somebody's instance.
	set("CLERK_MODE", "fake");
	set("CLERK_SECRET_KEY", "sk_test_not_a_secret");
	set("CLERK_FRONTEND_API_URL", "https://example.clerk.accounts.dev");

	expect(getClerkSecret()).toBe(null);
});

test("keeps the fake a fake when nothing said which to use", () => {
	set("CLERK_MODE", undefined);
	set("CLERK_SECRET_KEY", "sk_test_not_a_secret");

	expect(getClerkSecret()).toBe(null);
});

test("refuses a run that asked for the real Clerk with no secret", () => {
	// Falling back would report success in the same words as a run that met Clerk.
	set("CLERK_MODE", "real");
	set("CLERK_SECRET_KEY", "");
	set("CLERK_FRONTEND_API_URL", "https://example.clerk.accounts.dev");

	expect(() => getClerkSecret()).toThrow(namesTheSecret);
});

test("refuses a run that has the secret and not the instance it belongs to", () => {
	// The deployment trusts one issuer. Without it, every token Clerk signs is refused, which
	// would look like a broken sign-in rather than a run that was set up incompletely.
	set("CLERK_MODE", "real");
	set("CLERK_SECRET_KEY", "sk_test_not_a_secret");
	set("CLERK_FRONTEND_API_URL", undefined);

	expect(() => getClerkSecret()).toThrow(namesTheIssuer);
});

test("hands a run that asked for it the secret it was given", () => {
	set("CLERK_MODE", "real");
	set("CLERK_SECRET_KEY", "sk_test_not_a_secret");
	set("CLERK_FRONTEND_API_URL", "https://example.clerk.accounts.dev");

	expect(getClerkSecret()).toBe("sk_test_not_a_secret");
});
