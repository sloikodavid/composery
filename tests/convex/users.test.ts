import { beforeAll, expect, test } from "bun:test";
import { createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { ConvexError } from "convex/values";
import { api, internal } from "../../convex/_generated/api";
import {
	type ConvexBackend,
	useConvexBackend,
} from "../harness/convex-backend";

const setupTimeoutMs = 600_000;
const testTimeoutMs = 60_000;
const subjectSuffixBytes = 6;
const tokenLifetimeSeconds = 600;
const millisecondsPerSecond = 1000;

let backend: ConvexBackend;

beforeAll(async () => {
	backend = await useConvexBackend();
}, setupTimeoutMs);

/** A Clerk user ID that no other test uses, so tests that share the backend never share a user. */
function createSubject() {
	return `user_${randomBytes(subjectSuffixBytes).toString("hex")}`;
}

/** A whole account: Clerk holds it, and it is synced here, as it always is in production. */
async function syncUser(subject: string) {
	const account = {
		id: subject,
		username: subject.toLowerCase(),
		email: `${subject}@example.com`,
		imageUrl: "",
	};
	backend.clerk.setUser(account);
	await backend.runAsAdmin(internal.users.store, {
		users: [
			{
				clerkUserId: account.id,
				username: account.username,
				email: account.email,
				imageUrl: account.imageUrl,
			},
		],
	});
}

test(
	"a signed-in user resolves to the record synced for them, and a signed-out caller to nothing",
	async () => {
		const subject = createSubject();
		await syncUser(subject);
		expect(
			await backend.createClient(subject).query(api.users.getCurrent, {}),
		).toMatchObject({ clerkUserId: subject });
		expect(await backend.createClient().query(api.users.getCurrent, {})).toBe(
			null,
		);
	},
	testTimeoutMs,
);

test(
	"a verified sign-in without a synced record, or with a disabled one, resolves to nothing",
	async () => {
		const unsynced = createSubject();
		expect(
			await backend.createClient(unsynced).query(api.users.getCurrent, {}),
		).toBe(null);
		const disabled = createSubject();
		await syncUser(disabled);
		await backend.runAsAdmin(internal.users.disable, {
			clerkUserIds: [disabled],
		});
		expect(
			await backend.createClient(disabled).query(api.users.getCurrent, {}),
		).toBe(null);
	},
	testTimeoutMs,
);

test(
	"a token that the issuer did not sign is refused, even when it names a synced user",
	async () => {
		const subject = createSubject();
		await syncUser(subject);
		const genuine = backend.signIn(subject).split(".");
		const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
		const issuedAt = Math.floor(Date.now() / millisecondsPerSecond);
		const payload = Buffer.from(
			JSON.stringify({
				...JSON.parse(Buffer.from(genuine[1] ?? "", "base64url").toString()),
				iat: issuedAt,
				exp: issuedAt + tokenLifetimeSeconds,
			}),
		).toString("base64url");
		const forgedSignature = createSign("RSA-SHA256")
			.update(`${genuine[0]}.${payload}`)
			.sign(privateKey)
			.toString("base64url");
		const client = backend.createClient();
		client.setAuth(`${genuine[0]}.${payload}.${forgedSignature}`);
		await expect(client.query(api.users.getCurrent, {})).rejects.toThrow(
			"Could not verify OIDC token claim",
		);
	},
	testTimeoutMs,
);

test(
	"a signed-out caller cannot create a server, and learns why by code",
	async () => {
		const attempt = backend
			.createClient()
			.mutation(api.servers.lifecycle.create, {
				name: "never-created",
				requestId: crypto.randomUUID(),
			});
		await expect(attempt).rejects.toBeInstanceOf(ConvexError);
		await expect(attempt).rejects.toMatchObject({
			data: { code: "unauthenticated" },
		});
	},
	testTimeoutMs,
);
