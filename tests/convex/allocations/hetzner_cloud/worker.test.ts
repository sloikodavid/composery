import { beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
	type ConvexBackend,
	useConvexBackend,
} from "../../../../harness/convex/backend";
import {
	type HetznerFake,
	useHetznerFake,
} from "../../../../harness/hetzner/fake";
import {
	createServer,
	createServerOwner,
	readServerBackendRecord,
	readServerStatus,
	requireHetznerServerId,
	type ServerClient,
	settleServer,
} from "../../../../harness/servers";

const setupTimeoutMs = 600_000;
const testTimeoutMs = 300_000;
const subjectSuffixBytes = 6;
// A refusal that waits on something outside comes back after a minute, and then has to finish.
const waitingTimeoutMs = 420_000;
const waitingTestTimeoutMs = 600_000;
const forbidden = 403;
const createdServers = /^\/servers$/;
const createdPrimaryIps = /^\/primary_ips$/;
// The worker puts the rules back after it has done what was asked of it, so this waits for one
// more of its own cycles rather than for anything a test can ask for.
const partTimeoutMs = 120_000;
const partDelayMs = 500;

let backend: ConvexBackend;
let fake: HetznerFake;

beforeAll(async () => {
	backend = await useConvexBackend();
	fake = await useHetznerFake();
}, setupTimeoutMs);

/** The allocation a server is running on, which every request the worker sends for it names. */
async function requireAllocationId(serverId: Id<"servers">) {
	const allocationId = (await readServerBackendRecord(backend, serverId))
		?.allocation._id;
	if (allocationId === undefined) {
		throw new Error("The server has no allocation.");
	}
	return allocationId;
}

/** Whether a create request is for this allocation, by the label Composery puts on everything. */
function isForAllocation(allocationId: string) {
	return (body: unknown) =>
		(body as { labels?: Record<string, string> } | undefined)?.labels?.[
			"allocation-id"
		] === allocationId;
}

/** What the fake still holds for one allocation, which is what "deleted" has to mean. */
async function readOwnedResources(allocationId: string) {
	const reply = await fetch(
		`${fake.url}/v1/servers?label_selector=allocation-id=${allocationId}`,
	);
	const servers = ((await reply.json()) as { servers: unknown[] }).servers;
	const addressReply = await fetch(
		`${fake.url}/v1/primary_ips?label_selector=allocation-id=${allocationId}`,
	);
	// biome-ignore lint/style/useNamingConvention: the Hetzner Cloud API names this collection
	const addresses = ((await addressReply.json()) as { primary_ips: unknown[] })
		.primary_ips;
	return [...servers, ...addresses];
}

test(
	"a created server reaches running, with one server and two addresses at the provider",
	async () => {
		const client = await createServerOwner(backend);
		const serverId = await createServer(client);
		const status = await settleServer(backend, client, serverId, {
			until: "running",
		});
		const allocationId = await requireAllocationId(serverId);

		expect(status.status).toBe("running");
		expect(status.ipv4).not.toBe(null);
		expect(
			fake.countRequests({
				method: "POST",
				path: createdServers,
				body: isForAllocation(allocationId),
			}),
		).toBe(1);
		expect(
			fake.countRequests({
				method: "POST",
				path: createdPrimaryIps,
				body: isForAllocation(allocationId),
			}),
		).toBe(2);
	},
	testTimeoutMs,
);

test(
	"a create whose reply never arrives makes one server, not two",
	async () => {
		const client = await createServerOwner(backend);
		// The server is asked for only after both of its addresses exist, so this test learns its own
		// allocation well before that request can be sent, and loses only that one reply.
		let allocationId: string | undefined;
		const hasLostReply = fake.scriptOnce(
			{
				method: "POST",
				path: createdServers,
				body: (body) =>
					allocationId !== undefined && isForAllocation(allocationId)(body),
			},
			"lose",
		);
		const serverId = await createServer(client);
		allocationId = await requireAllocationId(serverId);

		const status = await settleServer(backend, client, serverId, {
			until: "running",
		});

		// Hetzner made the server and the answer never came. Composery found it again instead of
		// asking twice, which would have made a second server nobody can see.
		expect(hasLostReply()).toBe(true);
		expect(status.status).toBe("running");
		expect(
			fake.countRequests({
				method: "POST",
				path: createdServers,
				body: isForAllocation(allocationId),
			}),
		).toBe(1);
	},
	testTimeoutMs,
);

/** Asks for a power change and waits for the worker to carry it out. */
async function changePower(
	client: ServerClient,
	serverId: Id<"servers">,
	kind: "start" | "stop" | "forceStop",
	until: string,
) {
	const result = await client.mutation(api.servers.lifecycle.requestPower, {
		serverId,
		requestId: `request-${randomBytes(subjectSuffixBytes).toString("hex")}`,
		kind,
	});
	if (!result.ok) {
		throw new Error(`Asking to ${kind} failed: ${result.code}`);
	}
	return await settleServer(backend, client, serverId, { until });
}

test(
	"each power command is sent once, and a graceful stop never becomes a forced one",
	async () => {
		const client = await createServerOwner(backend);
		const serverId = await createServer(client);
		await settleServer(backend, client, serverId, { until: "running" });
		const hetznerServerId = await requireHetznerServerId(backend, serverId);
		const countAction = (action: string) =>
			fake.countRequests({
				method: "POST",
				path: new RegExp(`^/servers/${hetznerServerId}/actions/${action}$`),
			});

		expect(
			(await changePower(client, serverId, "stop", "stopped")).status,
		).toBe("stopped");
		expect(
			(await changePower(client, serverId, "start", "running")).status,
		).toBe("running");
		expect(
			(await changePower(client, serverId, "forceStop", "stopped")).status,
		).toBe("stopped");

		// Three commands, three different Hetzner actions, none of them repeated.
		expect(countAction("shutdown")).toBe(1);
		expect(countAction("poweron")).toBe(1);
		expect(countAction("poweroff")).toBe(1);
	},
	testTimeoutMs,
);

test(
	"a delete finishes and leaves nothing, even when a reply never arrives",
	async () => {
		const client = await createServerOwner(backend);
		const serverId = await createServer(client);
		await settleServer(backend, client, serverId, { until: "running" });
		const record = await readServerBackendRecord(backend, serverId);
		const allocationId = record?.allocation._id;
		if (allocationId === undefined) {
			throw new Error("The server has no allocation.");
		}
		const deletedThisServer = {
			method: "DELETE",
			path: new RegExp(
				`^/servers/${await requireHetznerServerId(backend, serverId)}$`,
			),
		};
		// Hetzner deletes the server and answers nothing. Asking again must not delete a second
		// thing: by then the identifier could belong to somebody else.
		const hasLostReply = fake.scriptOnce(deletedThisServer, "lose");

		await client.mutation(api.servers.lifecycle.requestDelete, { serverId });
		await settleServer(backend, client, serverId, { until: "gone" });

		// Everything Composery made for this allocation is gone, not merely forgotten: at the
		// provider, and in our own tables, where a row left behind would name a server that is not
		// there.
		expect(hasLostReply()).toBe(true);
		expect(await readOwnedResources(allocationId)).toEqual([]);
		expect(await readServerBackendRecord(backend, serverId)).toBe(null);
		expect(fake.countRequests(deletedThisServer)).toBe(1);
	},
	testTimeoutMs,
);

test(
	"a refusal that waits on something outside is asked again, not given up on",
	async () => {
		const client = await createServerOwner(backend);
		// The project is at its limit. Nothing about the request is wrong, and nobody here can fix
		// it: an admin raises the limit, and until then the only right move is to ask again later.
		let allocationId: string | undefined;
		const hasRefused = fake.scriptOnce(
			{
				method: "POST",
				path: createdServers,
				body: (body) =>
					allocationId !== undefined && isForAllocation(allocationId)(body),
			},
			{
				status: forbidden,
				body: {
					error: {
						code: "resource_limit_exceeded",
						message: "project limit exceeded",
					},
				},
			},
		);
		const serverId = await createServer(client);
		allocationId = await requireAllocationId(serverId);

		const status = await settleServer(backend, client, serverId, {
			until: "running",
			timeoutMs: waitingTimeoutMs,
		});

		// The allocation says it is stuck while it waits, and then it finishes by itself.
		expect(hasRefused()).toBe(true);
		expect(status.status).toBe("running");
		expect(
			fake.countRequests({
				method: "POST",
				path: createdServers,
				body: isForAllocation(allocationId),
			}),
		).toBe(2);
	},
	waitingTestTimeoutMs,
);

/** Waits for one part of a server to say what it should, without asking for any work. */
async function settlePart(
	client: ServerClient,
	serverId: Id<"servers">,
	part: "firewall" | "server" | "addresses",
	until: string,
) {
	const deadline = Date.now() + partTimeoutMs;
	let seen = "";
	while (Date.now() < deadline) {
		const status = await readServerStatus(client, serverId);
		seen = status.parts[part];
		if (seen === until) {
			return status;
		}
		await Bun.sleep(partDelayMs);
	}
	throw new Error(`The ${part} stayed ${seen}.`);
}

test(
	"rules taken off a server stop nothing, and go back on by themselves",
	async () => {
		const client = await createServerOwner(backend);
		const serverId = await createServer(client);
		await settleServer(backend, client, serverId, { until: "running" });
		// An admin can take the project's rules off a server in Hetzner's own console, and a
		// customer cannot: they have no account in this project. So it is never a choice to
		// respect, and the server keeps running while it is unprotected.
		await fake.detachFirewall(await requireHetznerServerId(backend, serverId));

		// What the customer asked for happens first, and is not held up by what protects the server.
		const stopped = await changePower(client, serverId, "stop", "stopped");
		expect(stopped.status).toBe("stopped");
		expect(stopped.parts.server).toBe("ok");

		// Then the rules go back, without anybody asking.
		const repaired = await settlePart(client, serverId, "firewall", "ok");
		expect(repaired.status).toBe("stopped");
	},
	testTimeoutMs,
);
