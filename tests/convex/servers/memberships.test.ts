import { beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { ConvexHttpClient } from "convex/browser";
import { api, internal } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	type ConvexBackend,
	useConvexBackend,
} from "../../../harness/convex/backend";
import { createServer, createServerOwner } from "../../../harness/servers";

const setupTimeoutMs = 600_000;
const testTimeoutMs = 120_000;
const suffixBytes = 6;

let backend: ConvexBackend;
let shared: { client: ConvexHttpClient; serverId: Id<"servers"> };

beforeAll(async () => {
	backend = await useConvexBackend();
	const client = await createServerOwner(backend);
	shared = { client, serverId: await createServer(client) };
}, setupTimeoutMs);

test(
	"an address two accounts hold for a moment finds nobody, rather than a guess",
	async () => {
		const { client, serverId } = shared;
		// An email can temporarily identify two users; choosing one would grant access by guess.
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
