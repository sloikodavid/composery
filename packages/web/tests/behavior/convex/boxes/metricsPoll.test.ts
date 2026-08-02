import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { internal } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

import {
	boxOperations,
	seedBox,
	seedSettings,
	seedUser,
	stubDeploymentEnv,
	testConvex,
	withoutHetznerBackoff,
	type Harness
} from "../../../support/convex.ts";

// The sweep that turns a box's traffic into a suspension. Every hop of it was
// unexercised: the poll reads Hetzner, records a sample, and - only when the
// sample crosses a threshold staff have armed - starts a suspend operation
// against a paying customer's box. Nothing else in the system takes a box off
// the air without a person asking.

const NOW = Date.UTC(2026, 7, 9, 10, 11, 12);

withoutHetznerBackoff();

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	stubDeploymentEnv();
	vi.stubEnv("HETZNER_CLOUD_TOKEN", "token");
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

// One Hetzner metrics answer, in the shape `fetchServerMetricsSample` reads.
function stubMetrics(egressBps: number) {
	const point = (value: number): [number, string] => [1, String(value)];
	const body = {
		metrics: {
			time_series: {
				cpu: { values: [point(5)] },
				"network.0.bandwidth.in": { values: [point(1)] },
				"network.0.bandwidth.out": { values: [point(egressBps)] },
				"network.0.pps.in": { values: [point(1)] },
				"network.0.pps.out": { values: [point(1)] },
				"disk.0.bandwidth.read": { values: [point(1)] },
				"disk.0.bandwidth.write": { values: [point(1)] }
			}
		}
	};
	const fetchMock = vi.fn(async () =>
		Promise.resolve({
			ok: true,
			status: 200,
			text: async () => JSON.stringify(body)
		} as unknown as Response)
	);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

async function seedPolledBox(
	t: Harness,
	overrides: { slug: string; status?: "running" | "stopped"; serverId?: number }
) {
	const owner = await seedUser(t, { clerkUserId: `user_${overrides.slug}` });
	return await seedBox(t, {
		user_id: owner.clerkUserId,
		slug: overrides.slug,
		status: overrides.status ?? "running",
		hetzner_server_id: overrides.serverId ?? 1
	});
}

const samples = (t: Harness) =>
	t.run((ctx) => ctx.db.query("box_metrics").collect());

// Comfortably over the shipped 25 Mbit/s egress default, and under it.
const OVER = 500_000_000;
const UNDER = 1_000;

describe("polling the fleet's metrics", () => {
	test("records a sample for a running box", async () => {
		const t = testConvex();
		await seedSettings(t);
		const boxId = await seedPolledBox(t, { slug: "atlas" });
		stubMetrics(UNDER);

		await t.action(internal.boxes.metricsPoll.pollBoxMetrics, {});

		expect(await samples(t)).toMatchObject([
			{ box_id: boxId, egress_bps: UNDER, sampled_at: NOW }
		]);
	});

	// Stopped and suspended boxes are polled too: their server still exists and
	// still bills, and the chart on their page covers the hours before they
	// stopped rather than going blank.
	test("polls a stopped box as well as a running one", async () => {
		const t = testConvex();
		await seedSettings(t);
		await seedPolledBox(t, { slug: "up" });
		await seedPolledBox(t, { slug: "down", status: "stopped", serverId: 2 });
		stubMetrics(UNDER);

		await t.action(internal.boxes.metricsPoll.pollBoxMetrics, {});

		expect(await samples(t)).toHaveLength(2);
	});

	// A box with no Hetzner server has nothing to ask Hetzner about, and asking
	// would be a request for server `undefined`.
	test("skips a box with no server recorded", async () => {
		const t = testConvex();
		await seedSettings(t);
		const owner = await seedUser(t);
		await seedBox(t, { user_id: owner.clerkUserId, slug: "unbuilt" });
		const fetchMock = stubMetrics(UNDER);

		await t.action(internal.boxes.metricsPoll.pollBoxMetrics, {});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(await samples(t)).toEqual([]);
	});

	// This runs unattended against the whole fleet. One box Hetzner will not
	// answer about must not stop every other box's metrics from being recorded.
	test("keeps polling the fleet when one box fails", async () => {
		const t = testConvex();
		await seedSettings(t);
		await seedPolledBox(t, { slug: "broken", serverId: 1 });
		await seedPolledBox(t, { slug: "fine", serverId: 2 });
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (url.includes("/servers/1/")) throw new Error("Hetzner is down");
				return {
					ok: true,
					status: 200,
					text: async () =>
						JSON.stringify({
							metrics: { time_series: { cpu: { values: [] } } }
						})
				} as unknown as Response;
			})
		);

		// The Hetzner client retries a network failure with exponential backoff,
		// and this file runs on a fake clock, so the sweep only settles once those
		// sleeps are advanced. What is under test is that the other box is still
		// polled, not how long the broken one takes to give up.
		await t.action(internal.boxes.metricsPoll.pollBoxMetrics, {});

		expect(await samples(t)).toHaveLength(1);
	});
});

// The one path that suspends a box without anyone asking, end to end.
describe("suspending a box its traffic flagged", () => {
	async function pollUntilSustained(t: Harness, times = 4) {
		for (let index = 0; index < times; index += 1) {
			await t.action(internal.boxes.metricsPoll.pollBoxMetrics, {});
		}
	}

	test("starts a suspension once a crossing is sustained and armed", async () => {
		const t = testConvex();
		await seedSettings(t, { auto_suspend_enabled: true });
		const boxId = await seedPolledBox(t, { slug: "noisy" });
		stubMetrics(OVER);

		await pollUntilSustained(t);

		expect(await boxOperations(t, boxId)).toMatchObject([
			{
				type: "suspend",
				trigger: "system:abuse_suspension",
				metadata: {
					reason: expect.stringContaining(
						"Automatic suspension: Sustained outbound bandwidth"
					)
				}
			}
		]);
	});

	// Flagging is observation; suspending is an action against a customer's box.
	// Staff arm it, and until they do a crossing is recorded and nothing else.
	test("suspends nothing while staff have not armed it", async () => {
		const t = testConvex();
		await seedSettings(t, { auto_suspend_enabled: false });
		const boxId = await seedPolledBox(t, { slug: "noisy" });
		stubMetrics(OVER);

		await pollUntilSustained(t);

		expect(await boxOperations(t, boxId)).toEqual([]);
		expect(
			await t.run((ctx) => ctx.db.query("box_flags").collect())
		).toHaveLength(1);
	});

	test("suspends nothing for traffic under the threshold", async () => {
		const t = testConvex();
		await seedSettings(t, { auto_suspend_enabled: true });
		const boxId = await seedPolledBox(t, { slug: "quiet" });
		stubMetrics(UNDER);

		await pollUntilSustained(t);

		expect(await boxOperations(t, boxId)).toEqual([]);
	});

	// Keyed by the flag, so the sweep that keeps running while the suspension is
	// in flight does not queue a second one behind it.
	test("starts one suspension however many polls follow the flag", async () => {
		const t = testConvex();
		await seedSettings(t, { auto_suspend_enabled: true });
		const boxId = await seedPolledBox(t, { slug: "noisy" });
		stubMetrics(OVER);

		await pollUntilSustained(t, 8);

		expect(
			(await boxOperations(t, boxId)).filter(
				(operation) => operation.type === "suspend"
			)
		).toHaveLength(1);
	});
});

describe("probing whether a box is serving", () => {
	async function probe(t: Harness, boxId: Id<"boxes">) {
		return await t.action(internal.boxes.health.probeRuntime, { boxId });
	}

	test("reads a healthy box as reachable", async () => {
		const t = testConvex();
		const boxId = await seedPolledBox(t, { slug: "atlas" });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: true }) as Response)
		);

		expect(await probe(t, boxId)).toEqual({ reachable: true });
	});

	// Anything but a 2xx is not serving. A box answering 502 from its own proxy
	// is exactly the state automatic repair exists for, and reading a response as
	// success because one arrived would make the whole health sweep inert.
	test("reads a non-ok answer as unreachable", async () => {
		const t = testConvex();
		const boxId = await seedPolledBox(t, { slug: "atlas" });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false, status: 502 }) as Response)
		);

		expect(await probe(t, boxId)).toEqual({ reachable: false });
	});

	test("reads a host that never answers as unreachable", async () => {
		const t = testConvex();
		const boxId = await seedPolledBox(t, { slug: "atlas" });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("connect ETIMEDOUT");
			})
		);

		expect(await probe(t, boxId)).toEqual({ reachable: false });
	});

	// The probe is of the box's public URL, which is what an owner would open -
	// probing anything else would report a layer nobody uses.
	test("asks the box's own public health endpoint", async () => {
		const t = testConvex();
		const boxId = await seedPolledBox(t, { slug: "atlas" });
		const requested: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: URL | string) => {
				requested.push(String(url));
				return { ok: true } as Response;
			})
		);

		await probe(t, boxId);

		expect(requested[0]).toBe(
			"https://atlas.dev.composery.cloud/_composery/healthz"
		);
	});
});
