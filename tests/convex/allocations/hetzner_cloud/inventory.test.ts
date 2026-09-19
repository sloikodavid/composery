import { beforeAll, expect, test } from "bun:test";
import { internal } from "../../../../convex/_generated/api";
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
	readServerStatus,
	requireHetznerServerId,
	type ServerClient,
	type ServerStatus,
	settleServer,
} from "../../../../harness/servers";

const setupTimeoutMs = 600_000;
const testTimeoutMs = 600_000;
// A cycle is one page of servers and one of addresses, ten seconds apart, so a fleet this size
// comes round about every twenty seconds. The bound is longer than that: a sweep takes the
// scan's lease before its run starts, so a run that waits behind other work holds the lease
// for its two minutes, and the worst a change can wait is that lease and then a cycle.
const scanTimeoutMs = 240_000;
const scanDelayMs = 250;
// The deployment paces its own scan; asking for a sweep faster than that spends nothing.
const sweepEveryMs = 2000;
const pageTrailLength = 6;

let backend: ConvexBackend;
let fake: HetznerFake;

beforeAll(async () => {
	backend = await useConvexBackend();
	fake = await useHetznerFake();
}, setupTimeoutMs);

/** Waits for the inventory scan, and nothing else, to bring one server's status up to date. */
async function scanUntil(
	client: ServerClient,
	serverId: Id<"servers">,
	until: string,
): Promise<ServerStatus> {
	const deadline = Date.now() + scanTimeoutMs;
	let sweptAt = 0;
	let status = "";
	while (Date.now() < deadline) {
		const state = await readServerStatus(client, serverId);
		status = state.status;
		if (status === until) {
			return state;
		}
		if (Date.now() - sweptAt > sweepEveryMs) {
			sweptAt = Date.now();
			await backend.runAsAdmin(
				internal.allocations.hetzner_cloud.inventory.sweep,
				{},
			);
		}
		await Bun.sleep(scanDelayMs);
	}
	// What the scan did while it was waited on: a page it never read is a different fault from
	// a page it read and made nothing of.
	const pages = fake
		.requests()
		.slice(-pageTrailLength)
		.map((request) => `${request.method} ${request.path.slice(0, 60)}`);
	throw new Error(
		`The scan left the server ${status}, after ${pages.length} pages: ${pages.join(" ;; ")}`,
	);
}

test(
	"a server stopped at the provider is noticed by the scan, with no request of its own",
	async () => {
		const client = await createServerOwner(backend);
		const serverId = await createServer(client);
		await settleServer(backend, client, serverId, { until: "running" });
		const hetznerServerId = await requireHetznerServerId(backend, serverId);
		const askedAbout = {
			method: "GET",
			path: new RegExp(`^/servers/${hetznerServerId}$`),
		};
		const askedBefore = fake.countRequests(askedAbout);
		// Somebody stops the server in Hetzner's own console. Nobody tells Composery, and nothing
		// wakes the allocation: one that has settled is not asked about again.
		await fake.stopServer(hetznerServerId);

		const stopped = await scanUntil(client, serverId, "stopped");

		// The scan reads fifty servers in one request, so noticing costs the same whatever the fleet
		// is. An allocation that polled its own server would have made it cost one request each.
		expect(stopped.status).toBe("stopped");
		expect(stopped.parts.server).toBe("ok");
		expect(stopped.ipv4).not.toBe(null);
		expect(fake.countRequests(askedAbout)).toBe(askedBefore);
	},
	testTimeoutMs,
);
