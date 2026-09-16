import { beforeAll, expect, test } from "bun:test";
import { createHmac, randomBytes } from "node:crypto";
import { api } from "../../convex/_generated/api";
import {
	type ConvexBackend,
	useConvexBackend,
} from "../harness/convex-backend";

const setupTimeoutMs = 600_000;
const testTimeoutMs = 60_000;
const subjectSuffixBytes = 6;
const millisecondsPerSecond = 1000;
const noContent = 204;
const badRequest = 400;
const serviceUnavailable = 503;
const accountReadPath = /^\/users\//;

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
		username: id.toLowerCase(),
		email: `${id}@example.com`,
		imageUrl: "https://example.com/avatar.png",
	};
}

test(
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

test(
	"a webhook Clerk cannot answer for is asked for again, and says nothing about why",
	async () => {
		const account = toAccount();
		backend.clerk.setUser(account);
		// Clerk refuses the read the route makes, so the route never learns the account's state.
		backend.clerk.scriptOnce(
			{ method: "GET", path: accountReadPath },
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
		expect(reply.status).toBe(serviceUnavailable);
		expect(await reply.text()).toBe("");
		expect(
			await backend.createClient(account.id).query(api.users.getCurrent, {}),
		).toBe(null);
	},
	testTimeoutMs,
);
