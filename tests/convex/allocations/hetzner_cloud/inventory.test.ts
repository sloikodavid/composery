import { afterAll, beforeAll, expect, test } from "bun:test";
import { internal } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
	type ConvexBackend,
	startConvexBackend,
} from "../../../../harness/convex/backend";
import type { HetznerFake } from "../../../../harness/hetzner/fake";
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
const scanTimeoutMs = 240_000;
const scanDelayMs = 250;
const sweepEveryMs = 2000;
// This helper waits for the inventory scan, not the allocation worker.
const pageTrailLength = 6;

let backend: ConvexBackend;
let fake: HetznerFake;

const resources = new AsyncDisposableStack();

beforeAll(async () => {
	backend = await startConvexBackend();
	resources.defer(backend.stop);
	fake = backend.hetzner;
}, setupTimeoutMs);

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
		// External stop is not a local event; only the next scan observes it.
		await fake.stopServer(hetznerServerId);

		const stopped = await scanUntil(client, serverId, "stopped");

		expect(stopped.status).toBe("stopped");
		expect(stopped.parts.server).toBe("ok");
		expect(stopped.ipv4).not.toBe(null);
		expect(fake.countRequests(askedAbout)).toBe(askedBefore);
	},
	testTimeoutMs,
);

afterAll(() => resources.disposeAsync(), setupTimeoutMs);
