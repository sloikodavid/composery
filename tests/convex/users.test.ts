import { afterAll, beforeAll, expect, test } from "bun:test";
import { createSign, generateKeyPairSync } from "node:crypto";
import { ConvexError } from "convex/values";
import { api } from "../../convex/_generated/api";
import {
	type ConvexBackend,
	startConvexBackend,
} from "../../harness/convex/backend";

const setupTimeoutMs = 600_000;
const testTimeoutMs = 60_000;
const tokenLifetimeSeconds = 600;
const millisecondsPerSecond = 1000;

let backend: ConvexBackend;

const resources = new AsyncDisposableStack();

beforeAll(async () => {
	backend = await startConvexBackend();
	resources.defer(backend.stop);
}, setupTimeoutMs);

test(
	"a signed-in user resolves to the record synced for them, and a signed-out caller to nothing",
	async () => {
		const { id } = await backend.createAccount();
		expect(
			await backend.createClient(id).query(api.users.getCurrent, {}),
		).toMatchObject({ clerkUserId: id });
		expect(await backend.createClient().query(api.users.getCurrent, {})).toBe(
			null,
		);
	},
	testTimeoutMs,
);

test(
	"a verified sign-in without a synced record resolves to nothing",
	async () => {
		// Clerk can authenticate before its webhook creates the local row.
		const { id } = await backend.createAccount({ synced: false });
		expect(await backend.createClient(id).query(api.users.getCurrent, {})).toBe(
			null,
		);
	},
	testTimeoutMs,
);

test(
	"a token that the issuer did not sign is refused, even when it names a synced user",
	async () => {
		const { id } = await backend.createAccount();
		const genuine = backend.signIn(id).split(".");
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

afterAll(() => resources.disposeAsync(), setupTimeoutMs);
