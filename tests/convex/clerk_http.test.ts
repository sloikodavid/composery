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

function toUserCreated(subject: string) {
	return JSON.stringify({
		type: "user.created",
		object: "event",
		data: {
			id: subject,
			username: subject.toLowerCase(),
			// biome-ignore-start lint/style/useNamingConvention: Clerk names these fields
			email_addresses: [
				{ id: "idn_1", email_address: `${subject}@example.com` },
			],
			primary_email_address_id: "idn_1",
			image_url: "https://example.com/avatar.png",
			// biome-ignore-end lint/style/useNamingConvention: Clerk names these fields
		},
	});
}

test(
	"a webhook Clerk signed syncs the user, and one it did not is refused",
	async () => {
		const subject = `user_${randomBytes(subjectSuffixBytes).toString("hex")}`;
		// Clerk holds the account; the webhook only says that something about it changed.
		backend.clerk.setUser({
			id: subject,
			username: subject.toLowerCase(),
			email: `${subject}@example.com`,
			imageUrl: "https://example.com/avatar.png",
		});
		const url = `${backend.siteUrl}/webhooks/clerk`;
		const body = toUserCreated(subject);

		const forged = await fetch(url, toSignedRequest(body, "whsec_AAAAAAAA"));
		expect(forged.status).toBe(badRequest);
		expect(
			await backend.createClient(subject).query(api.users.getCurrent, {}),
		).toBe(null);

		const genuine = await fetch(
			url,
			toSignedRequest(body, backend.webhookSecret),
		);
		expect(genuine.status).toBe(noContent);
		expect(
			await backend.createClient(subject).query(api.users.getCurrent, {}),
		).toMatchObject({ clerkUserId: subject });
	},
	testTimeoutMs,
);
