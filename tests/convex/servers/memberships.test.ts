import { beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { api, internal } from "../../../convex/_generated/api";
import {
	type ConvexBackend,
	useConvexBackend,
} from "../../harness/convex-backend";

const setupTimeoutMs = 600_000;
const testTimeoutMs = 120_000;
const suffixBytes = 6;
const quotaLimit = 10;

let backend: ConvexBackend;
let shared: Awaited<ReturnType<typeof createServerAsOwner>>;

beforeAll(async () => {
	backend = await useConvexBackend();
	// Every server a test makes is driven by the deployment's own worker, which paces itself and is
	// shared by the whole run. Both tests only need a server to share, so they share one.
	shared = await createServerAsOwner();
}, setupTimeoutMs);

async function createServerAsOwner() {
	const owner = await backend.createAccount();
	const client = backend.createClient(owner.id);
	const user = await client.query(api.users.getCurrent, {});
	if (user === null) {
		throw new Error("The owner did not sync.");
	}
	await backend.runAsAdmin(internal.quotas.setForUser, {
		userId: user._id,
		kind: "server",
		limit: quotaLimit,
	});
	await backend.runAsAdmin(internal.quotas.setForDeployment, {
		kind: "server",
		limit: quotaLimit,
	});
	const name = `test-${randomBytes(suffixBytes).toString("hex")}`;
	const created = await client.mutation(api.servers.lifecycle.create, {
		name,
		requestId: `request-${randomBytes(suffixBytes).toString("hex")}`,
	});
	if (!created.ok) {
		throw new Error(`Creating the server failed: ${created.code}`);
	}
	const server = await client.query(api.servers.names.getByName, { name });
	if (server === null) {
		throw new Error("The created server is not readable.");
	}
	return { client, serverId: server._id };
}

test(
	"a username two accounts hold for a moment finds nobody, rather than a guess",
	async () => {
		const { client, serverId } = shared;
		// Clerk lets a username be released and taken, and each account reaches us on its own
		// webhook. Until the older one arrives, two accounts here hold the same name.
		const username = `shared-${randomBytes(suffixBytes).toString("hex")}`;
		await backend.runAsAdmin(internal.users.store, {
			users: [
				{
					clerkUserId: `user_${randomBytes(suffixBytes).toString("hex")}`,
					username,
				},
				{
					clerkUserId: `user_${randomBytes(suffixBytes).toString("hex")}`,
					username,
				},
			],
		});

		const result = await client.mutation(api.servers.memberships.add, {
			serverId,
			username,
		});

		// Sharing a server with one of them would be deciding who was meant. Only one person can be.
		expect(result).toMatchObject({ ok: false, code: "user_not_unique" });
	},
	testTimeoutMs,
);

test(
	"an account without a username cannot be found to be shared with",
	async () => {
		const { client, serverId } = shared;
		const clerkUserId = `user_${randomBytes(suffixBytes).toString("hex")}`;
		await backend.runAsAdmin(internal.users.store, {
			users: [{ clerkUserId }],
		});

		const result = await client.mutation(api.servers.memberships.add, {
			serverId,
			username: clerkUserId,
		});

		expect(result).toMatchObject({ ok: false, code: "user_not_found" });
	},
	testTimeoutMs,
);
