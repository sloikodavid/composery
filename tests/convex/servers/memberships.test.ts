import { beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { ConvexHttpClient } from "convex/browser";
import { api, internal } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	type ConvexBackend,
	useConvexBackend,
} from "../../harness/convex/backend";
import { createServer, createServerOwner } from "../../harness/servers";

const setupTimeoutMs = 600_000;
const testTimeoutMs = 120_000;
const suffixBytes = 6;

let backend: ConvexBackend;
let shared: { client: ConvexHttpClient; serverId: Id<"servers"> };

beforeAll(async () => {
	backend = await useConvexBackend();
	// Every server a test makes is driven by the deployment's own worker, which paces itself and is
	// shared by the whole run. Both tests only need a server to share, so they share one.
	const client = await createServerOwner(backend);
	shared = { client, serverId: await createServer(client) };
}, setupTimeoutMs);

test(
	"an address two accounts hold for a moment finds nobody, rather than a guess",
	async () => {
		const { client, serverId } = shared;
		// An address can move from one account to another, and each account reaches us on its own
		// webhook. Until the older one arrives, two accounts here hold the same address.
		const email = `shared-${randomBytes(suffixBytes).toString("hex")}@example.com`;
		await backend.runAsAdmin(internal.users.store, {
			users: [
				{
					clerkUserId: `user_${randomBytes(suffixBytes).toString("hex")}`,
					email,
				},
				{
					clerkUserId: `user_${randomBytes(suffixBytes).toString("hex")}`,
					email,
				},
			],
		});

		const result = await client.mutation(api.servers.memberships.add, {
			serverId,
			email,
		});

		// Sharing a server with one of them would be deciding who was meant. Only one person can be.
		expect(result).toMatchObject({ ok: false, code: "user_not_unique" });
	},
	testTimeoutMs,
);

test(
	"an account with no address cannot be found to be shared with",
	async () => {
		const { client, serverId } = shared;
		const clerkUserId = `user_${randomBytes(suffixBytes).toString("hex")}`;
		await backend.runAsAdmin(internal.users.store, {
			users: [{ clerkUserId }],
		});

		const result = await client.mutation(api.servers.memberships.add, {
			serverId,
			email: `${clerkUserId}@example.com`,
		});

		expect(result).toMatchObject({ ok: false, code: "user_not_found" });
	},
	testTimeoutMs,
);
