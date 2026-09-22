import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { api, internal } from "../../../convex/_generated/api";
import {
	type ConvexBackend,
	startConvexBackend,
} from "../../../harness/convex/backend";
import {
	createServer,
	createServerOwner,
	settleServer,
} from "../../../harness/servers";

const setupTimeoutMs = 600_000;
const testTimeoutMs = 300_000;
const expandedLimit = 2;
let backend: ConvexBackend;

const resources = new AsyncDisposableStack();

beforeAll(async () => {
	backend = await startConvexBackend();
	resources.defer(backend.stop);
}, setupTimeoutMs);

test(
	"concurrent creation, retries, and limit changes preserve quota usage",
	async () => {
		const client = await createServerOwner(backend);
		const user = await client.query(api.users.getCurrent, {});
		if (user === null) {
			throw new Error("The server owner did not sync.");
		}
		await backend.runAsAdmin(internal.servers.quotas.set, {
			userId: user._id,
			limit: 1,
		});
		const before = await backend.runAsAdmin(internal.servers.quotas.get, {});
		const requests = [0, 1].map(() => ({
			name: `quota-${randomUUID()}`,
			requestId: randomUUID(),
		}));
		const results = await Promise.all(
			requests.map((candidate) =>
				client.mutation(api.servers.lifecycle.create, candidate),
			),
		);
		const winner = results.findIndex((result) => result.ok);
		const created = results[winner];
		const request = requests[winner];
		if (created === undefined || !created.ok || request === undefined) {
			throw new Error("No server was created.");
		}
		expect(results.filter((result) => result.ok)).toHaveLength(1);
		expect(results.find((result) => !result.ok)).toMatchObject({
			ok: false,
			code: "server_quota_reached",
		});
		expect(
			await client.mutation(api.servers.lifecycle.create, request),
		).toEqual(created);
		expect(
			await backend.runAsAdmin(internal.servers.quotas.get, {
				userId: user._id,
			}),
		).toEqual({ limit: 1, used: 1 });
		expect(
			(await backend.runAsAdmin(internal.servers.quotas.get, {})).used,
		).toBe(before.used + 1);
		await backend.runAsAdmin(internal.servers.quotas.set, {
			userId: user._id,
			limit: 0,
		});
		expect(
			await backend.runAsAdmin(internal.servers.quotas.get, {
				userId: user._id,
			}),
		).toEqual({ limit: 0, used: 1 });
		await backend.runAsAdmin(internal.servers.quotas.set, {
			userId: user._id,
			limit: expandedLimit,
		});
		const secondId = await createServer(client);
		for (const serverId of [created.serverId, secondId]) {
			await client.mutation(api.servers.lifecycle.requestDelete, { serverId });
			await settleServer(backend, client, serverId, { until: "gone" });
		}
		expect(
			await backend.runAsAdmin(internal.servers.quotas.get, {
				userId: user._id,
			}),
		).toEqual({ limit: expandedLimit, used: 0 });
		expect(
			(await backend.runAsAdmin(internal.servers.quotas.get, {})).used,
		).toBe(before.used);
	},
	testTimeoutMs,
);

afterAll(() => resources.disposeAsync(), setupTimeoutMs);
