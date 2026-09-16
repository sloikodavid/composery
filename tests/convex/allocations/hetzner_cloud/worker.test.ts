import { beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { api, internal } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
	type ConvexBackend,
	useConvexBackend,
} from "../../../harness/convex-backend";
import { type HetznerFake, useHetznerFake } from "../../../harness/hetzner";

const setupTimeoutMs = 600_000;
const testTimeoutMs = 120_000;
const subjectSuffixBytes = 6;
const quotaLimit = 10;
const settleTimeoutMs = 180_000;
const settleDelayMs = 250;
// The deployment paces its own work, so asking for a sweep faster than that starves the worker.
const sweepEveryMs = 2000;
// Enough of the trail to show where a stuck allocation stopped.
const trailLength = 12;
const createdServers = /^servers$/;
const createdPrimaryIps = /^primary_ips$/;

let backend: ConvexBackend;
let fake: HetznerFake;

beforeAll(async () => {
	backend = await useConvexBackend();
	fake = await useHetznerFake();
}, setupTimeoutMs);

/** One owner with room for servers, so no test waits on another's quota. */
async function createOwner() {
	const subject = `user_${randomBytes(subjectSuffixBytes).toString("hex")}`;
	await backend.runAsAdmin(internal.users.store, {
		users: [
			{
				clerkUserId: subject,
				username: subject.toLowerCase(),
				email: `${subject}@example.com`,
				imageUrl: "",
			},
		],
	});
	const client = backend.createClient(subject);
	const user = await client.query(api.users.getCurrent, {});
	if (user === null) {
		throw new Error("The user did not sync.");
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
	return client;
}

type ServerClient = Awaited<ReturnType<typeof createOwner>>;

async function createServer(client: ServerClient) {
	const name = `test-${randomBytes(subjectSuffixBytes).toString("hex")}`;
	const result = await client.mutation(api.servers.lifecycle.create, {
		name,
		requestId: `request-${randomBytes(subjectSuffixBytes).toString("hex")}`,
	});
	if (!result.ok) {
		throw new Error(`Creating the server failed: ${result.code}`);
	}
	const server = await client.query(api.servers.names.getByName, { name });
	if (server === null) {
		throw new Error("The created server is not readable.");
	}
	return server._id;
}

/** What the backend recorded, which is where a stuck allocation says why it stopped. */
async function readBackendRecord(serverId: Id<"servers">) {
	const allocation = await backend.runAsAdmin(
		internal.allocations.operations.getForServer,
		{ serverId },
	);
	if (allocation === null) {
		return null;
	}
	return {
		allocation,
		backend: await backend.runAsAdmin(
			internal.allocations.hetzner_cloud.worker_state.get,
			{ allocationId: allocation._id },
		),
	};
}

/** Waits until the worker has taken the allocation as far as it can. */
async function settle(
	client: ServerClient,
	serverId: Id<"servers">,
	until: (status: string) => boolean,
) {
	const deadline = Date.now() + settleTimeoutMs;
	let status = "creating";
	let sweptAt = 0;
	while (Date.now() < deadline) {
		const state = await client.query(api.servers.lifecycle.getStatus, {
			serverId,
		});
		status = state.status;
		if (until(status)) {
			return state;
		}
		// The deployment's own sweep runs every ten seconds; a test asks for it sooner.
		if (Date.now() - sweptAt > sweepEveryMs) {
			sweptAt = Date.now();
			await backend.runAsAdmin(
				internal.allocations.hetzner_cloud.worker_state.sweep,
				{},
			);
		}
		await Bun.sleep(settleDelayMs);
	}
	const trail = fake
		.requests()
		.slice(-trailLength)
		.map((request) => `${request.method} ${request.path}`);
	throw new Error(
		`The allocation stayed ${status}: ${JSON.stringify(await readBackendRecord(serverId))} :: ${trail.join(" ;; ")}`,
	);
}

test(
	"a created server reaches running, with one server and two addresses at the provider",
	async () => {
		const client = await createOwner();
		const before = fake.countRequests("POST", createdServers);
		const serverId = await createServer(client);
		const status = await settle(
			client,
			serverId,
			(value) => value === "running" || value === "blocked",
		);

		expect(status.status).toBe("running");
		expect(status.ipv4).not.toBe(null);
		expect(fake.countRequests("POST", createdServers) - before).toBe(1);
	},
	testTimeoutMs,
);

test(
	"a create whose reply never arrives makes one server, not two",
	async () => {
		const client = await createOwner();
		const before = fake.countRequests("POST", createdPrimaryIps);
		// Hetzner takes the request and answers nothing: the outcome is unknown, not failed.
		fake.scriptOnce({ method: "POST", path: createdPrimaryIps }, "lose");
		const serverId = await createServer(client);
		const status = await settle(
			client,
			serverId,
			(value) => value === "running" || value === "blocked",
		);

		expect(status.status).toBe("running");
		// One address was lost to the silence and found again; the second is the other kind.
		expect(fake.countRequests("POST", createdPrimaryIps) - before).toBe(2);
	},
	testTimeoutMs,
);
