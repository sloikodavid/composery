import { afterEach, expect, test } from "bun:test";
import { getClerkSecret } from "../../../harness/clerk/real";

const namesTheSecret = /CLERK_SECRET_KEY/;
const namesTheIssuer = /CLERK_FRONTEND_API_URL/;
const secondPageOffset = 100;
const malformedUserRowPattern = /malformed user list row/;

type Named = "CLERK_MODE" | "CLERK_SECRET_KEY" | "CLERK_FRONTEND_API_URL";

const held: Record<Named, string | undefined> = {
	// biome-ignore-start lint/style/useNamingConvention: environment variable names
	CLERK_MODE: process.env.CLERK_MODE,
	CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
	CLERK_FRONTEND_API_URL: process.env.CLERK_FRONTEND_API_URL,
	// biome-ignore-end lint/style/useNamingConvention: environment variable names
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
	// Credentials alone must not select a billable or destructive integration.
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
	// Never fall back to fake after an explicit real-mode request.
	set("CLERK_MODE", "real");
	set("CLERK_SECRET_KEY", "");
	set("CLERK_FRONTEND_API_URL", "https://example.clerk.accounts.dev");

	expect(() => getClerkSecret()).toThrow(namesTheSecret);
});

test("refuses a run that has the secret and not the instance it belongs to", () => {
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

function clerkUser(id: string, externalId: string | null) {
	return {
		id,
		// biome-ignore lint/style/useNamingConvention: Clerk's user API uses snake_case
		external_id: externalId,
		// biome-ignore lint/style/useNamingConvention: Clerk's user API uses snake_case
		created_at: Date.now(),
	};
}

test("cleanup reads every Clerk page and validates rows", async () => {
	const { removeClerkLeftovers } = await import("../../../harness/clerk/real");
	const runTag = "local-run";
	const matching = clerkUser("owned-1", "composery-test-local-run-1");
	const first = [
		matching,
		...Array.from({ length: 99 }, (_, index) =>
			clerkUser(`other-${index}`, null),
		),
	];
	const second = [clerkUser("owned-2", "composery-test-local-run-2")];
	const deleted = new Set<string>();
	const paths: string[] = [];
	const request = (_secret: string, method: string, path: string) => {
		const url = new URL(path, "https://local.test");
		paths.push(`${url.pathname}${url.search}`);
		if (method === "DELETE") {
			deleted.add(url.pathname.split("/").at(-1) ?? "");
			return Promise.resolve({ status: 204, body: null });
		}
		const offset = Number(url.searchParams.get("offset"));
		if (offset === 0) {
			return Promise.resolve({
				status: 200,
				body: first.filter((user) => !deleted.has(user.id)),
			});
		}
		if (offset === secondPageOffset && deleted.size === 0) {
			return Promise.resolve({ status: 200, body: second });
		}
		return Promise.resolve({ status: 200, body: [] });
	};
	await removeClerkLeftovers("sk_test_local", runTag, request);

	expect(paths).toContain(`/users?limit=100&offset=${secondPageOffset}`);
	expect(deleted).toEqual(new Set(["owned-1", "owned-2"]));
});

test("cleanup rejects a malformed Clerk row", async () => {
	const { removeClerkLeftovers } = await import("../../../harness/clerk/real");
	const request = () =>
		Promise.resolve({ status: 200, body: [{ id: "missing-fields" }] });
	await expect(
		removeClerkLeftovers("sk_test_local", "local-run", request),
	).rejects.toThrow(malformedUserRowPattern);
});
