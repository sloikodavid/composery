import { randomBytes } from "node:crypto";
import type { FakeReply, FakeRequest } from "../fake";

const apiUrl = "https://api.clerk.com/v1";
const runTagBytes = 5;
const passwordBytes = 24;
const leftoverAgeMs = 3_600_000;
// Clerk acknowledges deletes before they disappear; cleanup polls.
const removeTimeoutMs = 60_000;
const tokenLifetimeSeconds = 3600;
const millisecondsPerSecond = 1000;
const httpMultipleChoices = 300;
const listPageSize = 100;
const maxListPages = 1000;
const httpNotFound = 404;

const externalIdPrefix = "composery-test-";
// Marks accounts owned by this harness.

type ClerkUserReply = Readonly<{
	id: string;
	// biome-ignore lint/style/useNamingConvention: external field name
	external_id: string | null;
	// biome-ignore lint/style/useNamingConvention: external field name
	created_at: number;
}>;

type ClerkRequest = (
	secret: string,
	method: string,
	path: string,
	body?: unknown,
) => Promise<{ status: number; body: unknown }>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isClerkUserReply(value: unknown): value is ClerkUserReply {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		(value.external_id === null || typeof value.external_id === "string") &&
		typeof value.created_at === "number" &&
		Number.isFinite(value.created_at)
	);
}

/** Only CLERK_MODE=real enables Clerk; credentials alone do not. */
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
	if (!secret.startsWith("sk_")) {
		throw new Error(
			"CLERK_SECRET_KEY does not look like a Clerk secret key, which starts with sk_. A value copied from the dashboard may carry the variable name with it.",
		);
	}
	if (!process.env.CLERK_FRONTEND_API_URL) {
		throw new Error(
			"This run asked for the real Clerk and CLERK_FRONTEND_API_URL holds nothing. The deployment trusts that issuer, so a token Clerk signs is refused without it.",
		);
	}
	return secret;
}

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
	return read2xx(method, path, reply);
}

function read2xx(
	method: string,
	path: string,
	reply: Readonly<{ status: number; body: unknown }>,
) {
	if (reply.status >= httpMultipleChoices) {
		throw new Error(
			`Clerk refused ${method} ${path}: ${reply.status} ${JSON.stringify(reply.body)}`,
		);
	}
	return reply.body;
}

async function remove(
	secret: string,
	userId: string,
	request: ClerkRequest = call,
) {
	const reply = await request(secret, "DELETE", `/users/${userId}`);
	if (reply.status >= httpMultipleChoices && reply.status !== httpNotFound) {
		throw new Error(`Clerk refused cleanup of user ${userId}: ${reply.status}`);
	}
}

/** Sends the request shape checked by the pinned Clerk contract. */
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

async function listOwned(secret: string, request: ClerkRequest = call) {
	const held: ClerkUserReply[] = [];
	const seen = new Set<string>();
	for (let page = 0; page < maxListPages; page += 1) {
		const offset = page * listPageSize;
		const path = `/users?limit=${listPageSize}&offset=${offset}`;
		const body = read2xx("GET", path, await request(secret, "GET", path));
		if (!Array.isArray(body)) {
			throw new Error("Clerk returned a user list that was not an array.");
		}
		if (!body.every(isClerkUserReply)) {
			throw new Error("Clerk returned a malformed user list row.");
		}
		for (const user of body) {
			if (seen.has(user.id)) {
				throw new Error("Clerk returned a user list that did not advance.");
			}
			seen.add(user.id);
			held.push(user);
		}
		if (body.length < listPageSize) {
			return held.filter((user) =>
				(user.external_id ?? "").startsWith(externalIdPrefix),
			);
		}
	}
	throw new Error(
		`Clerk returned ${maxListPages} full user pages without ending pagination.`,
	);
}

/** Deletes are eventually consistent; poll until no owned account remains. */
export async function removeClerkLeftovers(
	secret: string,
	runTag: string | null,
	request: ClerkRequest = call,
) {
	const isOurs = (user: ClerkUserReply) =>
		runTag === null
			? Date.now() - user.created_at > leftoverAgeMs
			: (user.external_id ?? "").startsWith(`${externalIdPrefix}${runTag}-`);
	const deadline = Date.now() + removeTimeoutMs;
	let held = (await listOwned(secret, request)).filter(isOurs);
	while (held.length > 0) {
		for (const user of held) {
			await remove(secret, user.id, request);
		}
		if (Date.now() > deadline) {
			throw new Error(
				`Clerk still holds ${held.length} of this run's accounts: ${held
					.map((user) => user.id)
					.join(", ")}`,
			);
		}
		held = (await listOwned(secret, request)).filter(isOurs);
	}
}

export type ClerkRun = Readonly<{
	stop: () => Promise<void>;
	createUser: (email: string) => Promise<{ id: string; email: string }>;
	tokenFor: (userId: string) => string;
	removeUser: (userId: string) => Promise<void>;
}>;

/** External IDs isolate this run's accounts; cleanup removes leftovers first. */
export async function createClerkRun(secret: string): Promise<ClerkRun> {
	const runTag = randomBytes(runTagBytes).toString("hex");
	await removeClerkLeftovers(secret, null);
	const tokens = new Map<string, string>();
	let made = 0;
	return {
		stop: () => removeClerkLeftovers(secret, runTag),
		createUser: async (email) => {
			made += 1;
			const body = await require2xx(secret, "POST", "/users", {
				// biome-ignore-start lint/style/useNamingConvention: external field names
				email_address: [email],
				external_id: `${externalIdPrefix}${runTag}-${made}`,
				password: randomBytes(passwordBytes).toString("base64url"),
				skip_password_checks: true,
				// biome-ignore-end lint/style/useNamingConvention: external field names
			});
			if (!isRecord(body) || typeof body.id !== "string") {
				throw new Error("Clerk did not return a created user.");
			}
			const { id } = body;
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
			await remove(secret, userId);
		},
	};
}

/** Mints a long-lived test token through Clerk's session endpoint. */
async function signIn(secret: string, userId: string) {
	const session = await require2xx(secret, "POST", "/sessions", {
		// biome-ignore lint/style/useNamingConvention: external field name
		user_id: userId,
	});
	if (!isRecord(session) || typeof session.id !== "string") {
		throw new Error("Clerk did not return a session.");
	}
	const token = await require2xx(
		secret,
		"POST",
		`/sessions/${session.id}/tokens`,
		// biome-ignore lint/style/useNamingConvention: external field name
		{ expires_in_seconds: tokenLifetimeSeconds },
	);
	if (!isRecord(token) || typeof token.jwt !== "string") {
		throw new Error("Clerk did not return a session token.");
	}
	return token.jwt;
}

export function toClerkTestEmail() {
	// Clerk's test address form does not send mail.
	return `composery+clerk_test_${randomBytes(runTagBytes).toString("hex")}@example.com`;
}

export const clerkSessionLifetimeMs =
	tokenLifetimeSeconds * millisecondsPerSecond;
