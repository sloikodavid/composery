import { randomBytes } from "node:crypto";
import { registerCleanup } from "../cleanup";
import type { FakeReply, FakeRequest } from "../fake";

/**
 * Clerk itself, for a run that asked to meet it. Accounts here are real: a run makes them, signs
 * in as them by asking Clerk for a session, and deletes every one it made. A development instance
 * holds a hundred accounts, so leaving them behind is not untidiness, it is the next run failing.
 *
 * Put the credentials in `.env.test` and run `CLERK_MODE=real bun test tests/convex/clerk.test.ts`.
 */

const apiUrl = "https://api.clerk.com/v1";
const runTagBytes = 5;
const leftoverAgeMs = 3_600_000;
// A delete is answered before Clerk has carried it out, so removal is asked for again until the
// instance stops listing them.
const removeTimeoutMs = 60_000;
// A run is minutes long and a session token is a minute by default, so the whole run gets one.
const tokenLifetimeSeconds = 3600;
const millisecondsPerSecond = 1000;
const httpMultipleChoices = 300;
const listPageSize = 100;

/** How a run marks the accounts it made, so it can find its own and nobody else's. */
const externalIdPrefix = "composery-test-";

type ClerkUserReply = Readonly<{
	id: string;
	// biome-ignore lint/style/useNamingConvention: the Clerk API names this field
	external_id: string | null;
	// biome-ignore lint/style/useNamingConvention: the Clerk API names this field
	created_at: number;
}>;

/**
 * The secret for the instance this run may use, or nothing, which keeps the fake a fake.
 *
 * `CLERK_MODE` says which one this run wants, and nothing else does: a secret that is merely
 * present changes nothing, so credentials can stay in `.env.test` between runs. A run that asked
 * for the real thing and was given no secret fails here rather than falling back, because it would
 * otherwise report success in the same words as a run that met Clerk.
 */
export function getClerkSecret() {
	if (process.env.CLERK_MODE !== "real") {
		return null;
	}
	const secret = process.env.CLERK_SECRET_KEY;
	if (!secret) {
		throw new Error(
			"This run asked for the real Clerk and CLERK_SECRET_KEY holds nothing. Fill it in, or set CLERK_MODE=fake.",
		);
	}
	if (!process.env.CLERK_FRONTEND_API_URL) {
		throw new Error(
			"This run asked for the real Clerk and CLERK_FRONTEND_API_URL holds nothing. The deployment trusts that issuer, so a token Clerk signs is refused without it.",
		);
	}
	return secret;
}

/** The issuer whose tokens the deployment trusts when a run meets Clerk. */
export function requireClerkIssuer() {
	const issuer = process.env.CLERK_FRONTEND_API_URL;
	if (!issuer) {
		throw new Error("CLERK_FRONTEND_API_URL holds nothing.");
	}
	return issuer;
}

async function call(
	secret: string,
	method: string,
	path: string,
	body?: unknown,
) {
	const reply = await fetch(`${apiUrl}${path}`, {
		method,
		headers: {
			authorization: `Bearer ${secret}`,
			...(body === undefined ? {} : { "content-type": "application/json" }),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	const text = await reply.text();
	return {
		status: reply.status,
		body: text === "" ? null : (JSON.parse(text) as unknown),
	};
}

async function require2xx(
	secret: string,
	method: string,
	path: string,
	body?: unknown,
) {
	const reply = await call(secret, method, path, body);
	if (reply.status >= httpMultipleChoices) {
		throw new Error(
			`Clerk refused ${method} ${path}: ${reply.status} ${JSON.stringify(reply.body)}`,
		);
	}
	return reply.body;
}

/**
 * Passes one request on to Clerk and brings back exactly what Clerk said. The deployment holds a
 * secret that reaches nothing, so what it sends can only ever leave through here, and the version
 * it asks for travels with it: an upgrade that changes the version must not be answered by an
 * instance speaking another one.
 */
export function toClerkForward(secret: string) {
	return async (request: FakeRequest): Promise<FakeReply> => {
		const reply = await fetch(`${apiUrl}${request.path}`, {
			method: request.method,
			headers: {
				authorization: `Bearer ${secret}`,
				...(request.headers["clerk-api-version"] === undefined
					? {}
					: { "clerk-api-version": request.headers["clerk-api-version"] }),
				...(request.body === undefined
					? {}
					: { "content-type": "application/json" }),
			},
			...(request.body === undefined
				? {}
				: { body: JSON.stringify(request.body) }),
		});
		const text = await reply.text();
		return {
			status: reply.status,
			body: text === "" ? null : (JSON.parse(text) as unknown),
		};
	};
}

/**
 * The accounts one run made, asked for by the mark it put on them, or every account any run left
 * behind. Clerk reads `external_id` as a filter, so its own answer is what a run acts on; there is
 * no filter for the prefix they share, which is why finding a dead run's accounts reads a page.
 */
async function listOwned(secret: string, externalId: string | null) {
	const query =
		externalId === null
			? `limit=${listPageSize}`
			: `external_id=${encodeURIComponent(externalId)}&limit=${listPageSize}`;
	const body = await require2xx(secret, "GET", `/users?${query}`);
	const held = Array.isArray(body) ? (body as ClerkUserReply[]) : [];
	return held.filter((user) =>
		(user.external_id ?? "").startsWith(externalIdPrefix),
	);
}

/**
 * Removes the accounts this run made, and the ones a run that was killed left behind. Each is
 * asked for again until Clerk stops listing it, because a delete is answered before the account
 * has gone, and what cannot be removed is raised: an instance that fills up refuses sign-ups.
 */
export async function removeClerkLeftovers(
	secret: string,
	externalId: string | null,
) {
	const isOurs = (user: ClerkUserReply) =>
		externalId === null
			? Date.now() - user.created_at > leftoverAgeMs
			: user.external_id === externalId;
	const deadline = Date.now() + removeTimeoutMs;
	let held = (await listOwned(secret, externalId)).filter(isOurs);
	while (held.length > 0) {
		for (const user of held) {
			await call(secret, "DELETE", `/users/${user.id}`);
		}
		if (Date.now() > deadline) {
			throw new Error(
				`Clerk still holds ${held.length} of this run's accounts: ${held
					.map((user) => user.id)
					.join(", ")}`,
			);
		}
		held = (await listOwned(secret, externalId)).filter(isOurs);
	}
}

export type ClerkRun = Readonly<{
	/** Makes one account at Clerk, marked as this run's, and holds a token to sign in as it. */
	createUser: (email: string) => Promise<{ id: string; email: string }>;
	/**
	 * The token Clerk signed for an account this run made. It is minted when the account is, so
	 * that signing in is something a test can do without waiting: a run that asks about somebody
	 * else's account is asking for a token nobody can give it.
	 */
	tokenFor: (userId: string) => string;
	/** Forgets one account, for a test that needs Clerk to no longer hold it. */
	removeUser: (userId: string) => Promise<void>;
}>;

/**
 * Makes this run its own mark in the instance, so that what it made is its own to remove, and what
 * an earlier run left behind goes first.
 */
export async function createClerkRun(secret: string): Promise<ClerkRun> {
	const externalId = `${externalIdPrefix}${randomBytes(runTagBytes).toString("hex")}`;
	await removeClerkLeftovers(secret, null);
	registerCleanup(async () => {
		await removeClerkLeftovers(secret, externalId);
	});
	const tokens = new Map<string, string>();
	return {
		createUser: async (email) => {
			const body = await require2xx(secret, "POST", "/users", {
				// biome-ignore-start lint/style/useNamingConvention: the Clerk API names these fields
				email_address: [email],
				external_id: externalId,
				// biome-ignore-end lint/style/useNamingConvention: the Clerk API names these fields
			});
			const { id } = body as ClerkUserReply;
			tokens.set(id, await signIn(secret, id));
			return { id, email };
		},
		tokenFor: (userId) => {
			const token = tokens.get(userId);
			if (token === undefined) {
				throw new Error(
					`This run did not make Clerk account ${userId}, so it cannot sign in as it.`,
				);
			}
			return token;
		},
		removeUser: async (userId) => {
			tokens.delete(userId);
			await require2xx(secret, "DELETE", `/users/${userId}`);
		},
	};
}

/** A session at Clerk and a token for it, which is how a run signs in without a browser. */
/**
 * A session at Clerk and a token for it, which is how a run signs in without a browser. Clerk
 * documents this for tests and allows it on a development instance alone. The token outlasts the
 * run on purpose: the default is a minute, and a test here is minutes long.
 */
async function signIn(secret: string, userId: string) {
	const session = await require2xx(secret, "POST", "/sessions", {
		// biome-ignore lint/style/useNamingConvention: the Clerk API names this field
		user_id: userId,
	});
	const token = await require2xx(
		secret,
		"POST",
		`/sessions/${(session as { id: string }).id}/tokens`,
		// biome-ignore lint/style/useNamingConvention: the Clerk API names this field
		{ expires_in_seconds: tokenLifetimeSeconds },
	);
	return (token as { jwt: string }).jwt;
}

/** What a run that meets Clerk gives an account for an address, so two runs never collide. */
export function toClerkTestEmail() {
	// Clerk reserves this form for testing and never sends mail to it.
	return `composery+clerk_test_${randomBytes(runTagBytes).toString("hex")}@example.com`;
}

export const clerkSessionLifetimeMs =
	tokenLifetimeSeconds * millisecondsPerSecond;
