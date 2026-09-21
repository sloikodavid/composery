import { beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { api, internal } from "../../convex/_generated/api";
import {
	type ConvexBackend,
	useConvexBackend,
} from "../../harness/convex/backend";
import {
	createServer,
	createServerOwner,
	settleServer,
} from "../../harness/servers";

const setupTimeoutMs = 600_000;
const testTimeoutMs = 300_000;
const expandedLimit = 2;

let backend: ConvexBackend;

beforeAll(async () => {
	backend = await useConvexBackend();
}, setupTimeoutMs);

test(
	"quota repair rejects a stale count and preserves usage when a limit changes",
	async () => {
		const client = await createServerOwner(backend);
		const user = await client.query(api.users.getCurrent, {});
		if (user === null) {
			throw new Error("The server owner did not sync.");
		}
		const snapshot = await backend.runAsAdmin(internal.quotas.readHeldPage, {
			kind: "server",
			cursor: null,
			userId: user._id,
		});
		expect(snapshot.used).toBe(0);
		const serverId = await createServer(client);
		expect(
			await backend.runAsAdmin(internal.quotas.applyReconciliation, {
				kind: "server",
				userId: user._id,
				limit: 1,
				used: snapshot.used,
				epoch: snapshot.epoch,
			}),
		).toBe(false);
		expect(
			await backend.runAsAdmin(internal.quotas.applyReconciliation, {
				kind: "server",
				limit: 1,
				used: 0,
				epoch: snapshot.epoch,
			}),
		).toBe(false);
		await backend.runAsAdmin(internal.quotas.reconcile, {
			userId: user._id,
			kind: "server",
			limit: 1,
		});
		const refused = await client.mutation(api.servers.lifecycle.create, {
			name: `quota-${randomUUID()}`,
			requestId: randomUUID(),
		});
		expect(refused).toMatchObject({ ok: false, code: "server_quota_reached" });
		await backend.runAsAdmin(internal.quotas.set, {
			userId: user._id,
			kind: "server",
			limit: expandedLimit,
		});
		const secondId = await createServer(client);
		for (const id of [serverId, secondId]) {
			await client.mutation(api.servers.lifecycle.requestDelete, {
				serverId: id,
			});
			await settleServer(backend, client, id, { until: "gone" });
		}
		const current = await backend.runAsAdmin(internal.quotas.readHeldPage, {
			kind: "server",
			cursor: null,
			userId: user._id,
		});
		expect(current.used).toBe(0);
		expect(current.epoch).toBeGreaterThan(snapshot.epoch);
	},
	testTimeoutMs,
);
