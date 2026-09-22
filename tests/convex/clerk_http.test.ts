import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHmac, randomBytes } from "node:crypto";
import { api, internal } from "../../convex/_generated/api";
import { getClerkSecret } from "../../harness/clerk/real";
import {
	type ConvexBackend,
	startConvexBackend,
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
const listPath = /^\/users\?(?!.*user_id=)/;
const scriptPollDelayMs = 1;

// Scripted fake responses exercise webhook verification and retry behavior.

const scripted = test.skipIf(getClerkSecret() !== null);

let backend: ConvexBackend;

const resources = new AsyncDisposableStack();

beforeAll(async () => {
	backend = await startConvexBackend();
	resources.defer(backend.stop);
}, setupTimeoutMs);

/** Signs the exact body Clerk would send; the route performs the verification. */
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

async function waitForScript(fired: () => boolean) {
	while (!fired()) {
		await Bun.sleep(scriptPollDelayMs);
	}
}

scripted(
	"a webhook Clerk signed syncs the account, and one it did not is refused",
	async () => {
		const account = toAccount();
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
		const hasRefused = backend.clerk.scriptOnce(
			{ method: "GET", path: new RegExp(`^/users/${account.id}$`) },
			{
				kind: "uncheckedReply",
				reply: { status: serviceUnavailable, body: null },
			},
		);
		const body = backend.clerk.toEvent("user.updated", account);

		const reply = await fetch(
			`${backend.siteUrl}/webhooks/clerk`,
			toSignedRequest(body, backend.webhookSecret),
		);

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
		// A 404 from another service or proxy is not proof of Clerk deletion.
		const hasAnswered = backend.clerk.scriptOnce(
			{ method: "GET", path: new RegExp(`^/users/${account.id}$`) },
			{ kind: "uncheckedReply", reply: { status: notFound, body: {} } },
		);

		const refused = await sendDeleted(account);

		expect(hasAnswered()).toBe(true);
		expect(refused.status).toBe(serviceUnavailable);
		expect(await readAccount(account)).toMatchObject({
			clerkUserId: account.id,
		});

		backend.clerk.removeUser(account.id);
		// Matching Clerk's own not-found code permits deletion.
		const accepted = await sendDeleted(account);
		expect(accepted.status).toBe(noContent);
		expect(await readAccount(account)).toBe(null);
	},
	testTimeoutMs,
);

scripted(
	"a delayed older webhook cannot restore an account deleted by a newer webhook",
	async () => {
		const account = await syncAccount();
		const delayed = backend.clerk.scriptOnce(
			{ method: "GET", path: new RegExp(`^/users/${account.id}$`) },
			{ kind: "delay", delayMs: 150 },
		);
		const update = fetch(
			`${backend.siteUrl}/webhooks/clerk`,
			toSignedRequest(
				backend.clerk.toEvent("user.updated", account),
				backend.webhookSecret,
			),
		);
		await waitForScript(delayed);
		backend.clerk.removeUser(account.id);
		const deleted = await sendDeleted(account);
		const updated = await update;

		expect(delayed()).toBe(true);
		expect(deleted.status).toBe(noContent);
		expect(updated.status).toBe(noContent);
		expect(await readAccount(account)).toBe(null);
	},
	testTimeoutMs,
);

scripted(
	"a list read that started first cannot overwrite a newer direct read",
	async () => {
		const account = await syncAccount();
		const updatedAccount = {
			...account,
			email: `${account.id}-new@example.com`,
		};
		const delayed = backend.clerk.scriptOnce(
			{ method: "GET", path: listPath },
			{ kind: "delay", delayMs: 150 },
		);
		const reconciliation = backend.runAsAdmin(internal.clerk.reconcile, {});
		await waitForScript(delayed);
		backend.clerk.setUser(updatedAccount);
		const updated = await fetch(
			`${backend.siteUrl}/webhooks/clerk`,
			toSignedRequest(
				backend.clerk.toEvent("user.updated", updatedAccount),
				backend.webhookSecret,
			),
		);
		await Promise.all([reconciliation, updated]);

		expect(delayed()).toBe(true);
		expect(updated.status).toBe(noContent);
		expect(await readAccount(account)).toMatchObject({
			email: updatedAccount.email,
		});
		backend.clerk.removeUser(account.id);
	},
	testTimeoutMs,
);

scripted(
	"a failed direct read can be repaired by the next list reconciliation",
	async () => {
		const account = await syncAccount();
		const updatedAccount = {
			...account,
			email: `${account.id}-recovered@example.com`,
		};
		backend.clerk.setUser(updatedAccount);
		const refused = backend.clerk.scriptOnce(
			{ method: "GET", path: new RegExp(`^/users/${account.id}$`) },
			{
				kind: "uncheckedReply",
				reply: { status: serviceUnavailable, body: null },
			},
		);
		const failed = await fetch(
			`${backend.siteUrl}/webhooks/clerk`,
			toSignedRequest(
				backend.clerk.toEvent("user.updated", updatedAccount),
				backend.webhookSecret,
			),
		);
		expect(refused()).toBe(true);
		expect(failed.status).toBe(serviceUnavailable);
		expect((await readAccount(account))?.email).toBe(account.email);

		await backend.runAsAdmin(internal.clerk.reconcile, {});
		expect(await readAccount(account)).toMatchObject({
			email: updatedAccount.email,
		});
		backend.clerk.removeUser(account.id);
	},
	testTimeoutMs,
);

scripted(
	"an account is kept when the secret key belongs to another Clerk instance",
	async () => {
		const account = await syncAccount();
		backend.clerk.removeUser(account.id);
		// Different signing keys mean the secret and issuer are different instances.
		const hasAnswered = backend.clerk.scriptOnce(
			{ method: "GET", path: keysPath },
			{
				kind: "uncheckedReply",
				reply: {
					status: httpOk,
					body: { keys: [{ kid: "another-instance", kty: "RSA" }] },
				},
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

		const reply = await sendDeleted(account);

		expect(reply.status).toBe(serviceUnavailable);
		expect(await readAccount(account)).toMatchObject({
			clerkUserId: account.id,
		});
		backend.clerk.removeUser(account.id);
	},
	testTimeoutMs,
);

afterAll(() => resources.disposeAsync(), setupTimeoutMs);
