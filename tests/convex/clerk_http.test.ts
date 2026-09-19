import { beforeAll, expect, test } from "bun:test";
import { createHmac, randomBytes } from "node:crypto";
import { api } from "../../convex/_generated/api";
import { getClerkSecret } from "../../harness/clerk/real";
import {
	type ConvexBackend,
	useConvexBackend,
} from "../../harness/convex/backend";

const setupTimeoutMs = 600_000;
const testTimeoutMs = 60_000;
const subjectSuffixBytes = 6;
const millisecondsPerSecond = 1000;
const noContent = 204;
const badRequest = 400;
const serviceUnavailable = 503;
const notFound = 404;
const httpOk = 200;
const keysPath = /^\/jwks$/;

/**
 * These hold Clerk to answers a test chooses: an account that is there, one that is gone, a
 * refusal, keys from another instance. A run that meets Clerk itself reads Clerk's own answers,
 * so there is nothing here for it to do and every test in this file says so rather than passing.
 */
const scripted = test.skipIf(getClerkSecret() !== null);

let backend: ConvexBackend;

beforeAll(async () => {
	backend = await useConvexBackend();
}, setupTimeoutMs);

/**
 * Signs a webhook the way Clerk does, so the route's own verification decides whether it is
 * genuine. Standard Webhooks signs `<id>.<timestamp>.<body>` with the secret after `whsec_`.
 */
function toSignedRequest(body: string, secret: string) {
	const id = `msg_${randomBytes(subjectSuffixBytes).toString("hex")}`;
	const timestamp = Math.floor(Date.now() / millisecondsPerSecond);
	const signature = createHmac(
		"sha256",
		Buffer.from(secret.replace("whsec_", ""), "base64"),
	)
		.update(`${id}.${timestamp}.${body}`)
		.digest("base64");
	return {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"svix-id": id,
			"svix-timestamp": String(timestamp),
			"svix-signature": `v1,${signature}`,
		},
		body,
	};
}

function toAccount() {
	const id = `user_${randomBytes(subjectSuffixBytes).toString("hex")}`;
	return {
		id,
		email: `${id}@example.com`,
		imageUrl: "https://example.com/avatar.png",
	};
}

/** An account that Clerk holds and Composery has stored, which is where a deletion starts. */
async function syncAccount() {
	const account = toAccount();
	backend.clerk.setUser(account);
	const reply = await fetch(
		`${backend.siteUrl}/webhooks/clerk`,
		toSignedRequest(
			backend.clerk.toEvent("user.created", account),
			backend.webhookSecret,
		),
	);
	expect(reply.status).toBe(noContent);
	return account;
}

async function sendDeleted(account: ReturnType<typeof toAccount>) {
	return await fetch(
		`${backend.siteUrl}/webhooks/clerk`,
		toSignedRequest(
			backend.clerk.toEvent("user.deleted", account),
			backend.webhookSecret,
		),
	);
}

async function readAccount(account: ReturnType<typeof toAccount>) {
	return await backend.createClient(account.id).query(api.users.getCurrent, {});
}

scripted(
	"a webhook Clerk signed syncs the account, and one it did not is refused",
	async () => {
		const account = toAccount();
		// Clerk holds the account; the webhook only says that something about it changed.
		backend.clerk.setUser(account);
		const url = `${backend.siteUrl}/webhooks/clerk`;
		const body = backend.clerk.toEvent("user.created", account);

		const forged = await fetch(url, toSignedRequest(body, "whsec_AAAAAAAA"));
		expect(forged.status).toBe(badRequest);
		expect(
			await backend.createClient(account.id).query(api.users.getCurrent, {}),
		).toBe(null);

		const genuine = await fetch(
			url,
			toSignedRequest(body, backend.webhookSecret),
		);
		expect(genuine.status).toBe(noContent);
		expect(
			await backend.createClient(account.id).query(api.users.getCurrent, {}),
		).toMatchObject({ clerkUserId: account.id });
	},
	testTimeoutMs,
);

scripted(
	"a webhook Clerk cannot answer for is asked for again, and says nothing about why",
	async () => {
		const account = toAccount();
		backend.clerk.setUser(account);
		// Clerk refuses the read the route makes, so the route never learns the account's state.
		const hasRefused = backend.clerk.scriptOnce(
			{ method: "GET", path: new RegExp(`^/users/${account.id}$`) },
			{
				status: serviceUnavailable,
				body: null,
			},
		);
		const body = backend.clerk.toEvent("user.updated", account);

		const reply = await fetch(
			`${backend.siteUrl}/webhooks/clerk`,
			toSignedRequest(body, backend.webhookSecret),
		);

		// Clerk sends a webhook again when it is not accepted, so a failure must ask for that.
		expect(hasRefused()).toBe(true);
		expect(reply.status).toBe(serviceUnavailable);
		expect(await reply.text()).toBe("");
		expect(
			await backend.createClient(account.id).query(api.users.getCurrent, {}),
		).toBe(null);
	},
	testTimeoutMs,
);

scripted(
	"an account is removed only when Clerk itself says it is gone",
	async () => {
		const account = await syncAccount();
		// Something at that address answers with the status but is not Clerk: a proxy, a gateway, a
		// misdirected request. Removing an account deletes every server it owns.
		const hasAnswered = backend.clerk.scriptOnce(
			{ method: "GET", path: new RegExp(`^/users/${account.id}$`) },
			{ status: notFound, body: {} },
		);

		const refused = await sendDeleted(account);

		expect(hasAnswered()).toBe(true);
		expect(refused.status).toBe(serviceUnavailable);
		expect(await readAccount(account)).toMatchObject({
			clerkUserId: account.id,
		});

		// Clerk's own answer, with its own code, is what removes it.
		backend.clerk.removeUser(account.id);
		const accepted = await sendDeleted(account);
		expect(accepted.status).toBe(noContent);
		expect(await readAccount(account)).toBe(null);
	},
	testTimeoutMs,
);

scripted(
	"an account is kept when the secret key belongs to another Clerk instance",
	async () => {
		const account = await syncAccount();
		backend.clerk.removeUser(account.id);
		// A key from another instance answers "no such account" for every account we hold. The two
		// sides publish the keys that tokens are signed by, and they do not agree here.
		const hasAnswered = backend.clerk.scriptOnce(
			{ method: "GET", path: keysPath },
			{
				status: httpOk,
				body: { keys: [{ kid: "another-instance", kty: "RSA" }] },
			},
		);

		const refused = await sendDeleted(account);

		expect(hasAnswered()).toBe(true);
		expect(refused.status).toBe(serviceUnavailable);
		expect(await readAccount(account)).toMatchObject({
			clerkUserId: account.id,
		});
	},
	testTimeoutMs,
);

scripted(
	"a deletion Clerk's own read does not agree with is asked for again",
	async () => {
		const account = await syncAccount();

		// Clerk says the account is gone and still returns it. Accepting would be the last time
		// Clerk mentions it, and the account would stay until the next reconcile.
		const reply = await sendDeleted(account);

		expect(reply.status).toBe(serviceUnavailable);
		expect(await readAccount(account)).toMatchObject({
			clerkUserId: account.id,
		});
		backend.clerk.removeUser(account.id);
	},
	testTimeoutMs,
);
