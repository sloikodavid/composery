import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
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
const suffixBytes = 6;

let backend: ConvexBackend;

const resources = new AsyncDisposableStack();

beforeAll(async () => {
	backend = await startConvexBackend();
	resources.defer(backend.stop);
}, setupTimeoutMs);

test(
	"a repeated power request returns its operation while the server is busy",
	async () => {
		const client = await createServerOwner(backend);
		const serverId = await createServer(client);
		await settleServer(backend, client, serverId, { until: "running" });
		const requestId = `request-${randomBytes(suffixBytes).toString("hex")}`;
		const first = await client.mutation(api.servers.lifecycle.requestPower, {
			serverId,
			requestId,
			kind: "stop",
		});
		if (!first.ok) {
			throw new Error(`The first power request failed: ${first.code}`);
		}
		const repeated = await client.mutation(api.servers.lifecycle.requestPower, {
			serverId,
			requestId,
			kind: "stop",
		});
		expect(repeated).toEqual({ ok: true, operationId: first.operationId });
		await settleServer(backend, client, serverId, { until: "stopped" });
		await client.mutation(api.servers.lifecycle.requestDelete, { serverId });
		await client.mutation(api.servers.lifecycle.requestDelete, { serverId });
		await settleServer(backend, client, serverId, { until: "gone" });
		await expect(
			backend.runAsAdmin(internal.servers.ownership.requestDeleteForServer, {
				serverId,
			}),
		).resolves.toBe(null);
	},
	testTimeoutMs,
);

test(
	"deployment quota counts servers until provider cleanup completes",
	async () => {
		const client = await createServerOwner(backend);
		const serverId = await createServer(client);
		await settleServer(backend, client, serverId, { until: "running" });
		await backend.runAsAdmin(internal.servers.quotas.set, {
			limit: 1,
		});
		const refused = await client.mutation(api.servers.lifecycle.create, {
			name: `test-${randomBytes(suffixBytes).toString("hex")}`,
			requestId: `request-${randomBytes(suffixBytes).toString("hex")}`,
		});
		expect(refused).toMatchObject({
			ok: false,
			code: "server_capacity_unavailable",
		});
		await client.mutation(api.servers.lifecycle.requestDelete, { serverId });
		await settleServer(backend, client, serverId, { until: "gone" });
	},
	testTimeoutMs,
);

afterAll(() => resources.disposeAsync(), setupTimeoutMs);
