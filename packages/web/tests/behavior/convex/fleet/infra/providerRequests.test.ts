import ssh2 from "ssh2";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "@/convex/_generated/api";
import {
	seedBox,
	seedUser,
	stubDeploymentEnv,
	testConvex
} from "../../../../support/convex.ts";

const privateKey = ssh2.utils
	.generateKeyPairSync("ed25519", { comment: "provider-test" })
	.private.replace(/\n/g, "\\n");

function response(body: unknown, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		text: async () => (body === undefined ? "" : JSON.stringify(body))
	} as Response;
}

function queuedFetch(
	...replies: { body?: unknown; status?: number }[]
): ReturnType<typeof vi.fn> {
	const fetch = vi.fn(async () => {
		const reply = replies.shift();
		if (!reply) throw new Error("The provider received an unexpected request.");
		return response(reply.body, reply.status);
	});
	vi.stubGlobal("fetch", fetch);
	return fetch;
}

function server(status = "running") {
	return {
		id: 42,
		name: "composery-atlas",
		status,
		created: "2026-08-01T00:00:00Z",
		public_net: {
			ipv4: { ip: "1.2.3.4" },
			ipv6: { ip: "2a01::1/64" }
		},
		server_type: { name: "cx23" },
		location: { name: "nbg1" }
	};
}

function runPollsImmediately() {
	vi.spyOn(globalThis, "setTimeout").mockImplementation((callback) => {
		if (typeof callback === "function") callback();
		return 0 as unknown as ReturnType<typeof setTimeout>;
	});
}

beforeEach(() => {
	stubDeploymentEnv();
	vi.stubEnv("HETZNER_CLOUD_TOKEN", "token");
	vi.stubEnv("HETZNER_BOX_IMAGE", "ubuntu-24.04");
	vi.stubEnv("HETZNER_FIREWALL_ID", "42");
	vi.stubEnv("HETZNER_SSH_KEYS", "123,composery-key");
	vi.stubEnv("SSH_PRIVATE_KEY", privateKey);
	vi.stubEnv("SSH_USER", "root");
	vi.stubEnv("CLOUDFLARE_DNS_TOKEN", "token");
	vi.stubEnv("CLOUDFLARE_ZONE_ID", "zone");
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("the Hetzner response boundary", () => {
	test("decodes a documented action response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				response({ action: { id: 7, status: "success", error: null } })
			)
		);

		await expect(
			testConvex().action(internal.fleet.infra.hetznerVps.getAction, {
				actionId: 7
			})
		).resolves.toEqual({ status: "success" });
	});

	test("rejects a successful response whose consumed id changed", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				response({
					action: { action_id: 7, status: "success", error: null }
				})
			)
		);

		await expect(
			testConvex().action(internal.fleet.infra.hetznerVps.getAction, {
				actionId: 7
			})
		).rejects.toThrow("Invalid Hetzner response at action.id");
	});

	test("creates a server and waits for the provider's authoritative placement", async () => {
		runPollsImmediately();
		const fetch = queuedFetch(
			{ body: { servers: [] } },
			{ body: { server: server("initializing") }, status: 201 },
			{ body: { server: server("initializing") } },
			{ body: { server: server() } }
		);
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, { user_id: owner.clerkUserId });

		await expect(
			t.action(internal.fleet.infra.hetznerVps.createServer, {
				boxId,
				serverType: "cx23",
				slug: "atlas"
			})
		).resolves.toMatchObject({
			serverId: 42,
			serverType: "cx23",
			location: "nbg1"
		});
		expect(fetch).toHaveBeenCalledTimes(4);
		expect(fetch.mock.calls[1][1]).toMatchObject({ method: "POST" });
	});

	test("resumes a prior labelled create without creating another server", async () => {
		const fetch = queuedFetch(
			{ body: { servers: [server()] } },
			{ body: { server: server() } }
		);
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, { user_id: owner.clerkUserId });

		await expect(
			t.action(internal.fleet.infra.hetznerVps.createServer, {
				boxId,
				serverType: "cx23",
				slug: "atlas"
			})
		).resolves.toMatchObject({ serverId: 42 });
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(fetch.mock.calls.every((call) => call[1]?.method !== "POST")).toBe(
			true
		);
	});

	test("waits for a rebuild action and then reads the rebuilt server", async () => {
		runPollsImmediately();
		queuedFetch(
			{
				body: { action: { id: 7, status: "running", error: null } },
				status: 201
			},
			{ body: { action: { id: 7, status: "running", error: null } } },
			{ body: { action: { id: 7, status: "success", error: null } } },
			{ body: { server: server() } }
		);

		await expect(
			testConvex().action(internal.fleet.infra.hetznerVps.rebuildServer, {
				serverId: 42,
				image: "ubuntu-24.04"
			})
		).resolves.toMatchObject({ serverId: 42 });
	});

	test("rejects a successful get that omits its server", async () => {
		queuedFetch(
			{
				body: { action: { id: 7, status: "running", error: null } },
				status: 201
			},
			{ body: { action: { id: 7, status: "success", error: null } } },
			{ body: {} }
		);

		await expect(
			testConvex().action(internal.fleet.infra.hetznerVps.rebuildServer, {
				serverId: 42,
				image: "ubuntu-24.04"
			})
		).rejects.toThrow("Hetzner did not return server 42");
	});

	test("waits until a deleted server returns the provider's not-found error", async () => {
		runPollsImmediately();
		queuedFetch(
			{ body: { server: server() } },
			{
				body: { error: { code: "not_found", message: "Server not found" } },
				status: 404
			}
		);

		await expect(
			testConvex().action(internal.fleet.infra.hetznerVps.waitServerDeleted, {
				serverId: 42
			})
		).resolves.toBeNull();
	});

	test("shuts down a running server and polls until it is off", async () => {
		runPollsImmediately();
		const fetch = queuedFetch(
			{ body: { server: server() } },
			{ body: undefined, status: 201 },
			{ body: { server: server("running") } },
			{ body: { server: server("off") } }
		);

		await expect(
			testConvex().action(internal.fleet.infra.hetznerVps.stopServer, {
				serverId: 42
			})
		).resolves.toBeNull();
		expect(fetch.mock.calls[1][0]).toContain("/actions/shutdown");
	});
});

describe("the Cloudflare response boundary", () => {
	const record = (id: string, type: "A" | "AAAA", content: string) => ({
		id,
		name: "atlas.dev.composery.cloud",
		type,
		content
	});

	test("decodes the records used to reconcile both addresses", async () => {
		const replies = [
			{ success: true, result: [record("a", "A", "1.2.3.4")] },
			{ success: true, result: [record("aaaa", "AAAA", "2a01::1")] }
		];
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response(replies.shift()))
		);

		await expect(
			testConvex().action(
				internal.fleet.infra.cloudflareDns.createRuntimeDnsRecords,
				{ ipv4: "1.2.3.4", ipv6: "2a01::1", slug: "atlas" }
			)
		).resolves.toEqual({ aRecordId: "a", aaaaRecordId: "aaaa" });
	});

	test("rejects a record whose consumed id changed", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				response({
					success: true,
					result: [
						{
							record_id: "a",
							name: "atlas.dev.composery.cloud",
							type: "A",
							content: "1.2.3.4"
						}
					]
				})
			)
		);

		await expect(
			testConvex().action(
				internal.fleet.infra.cloudflareDns.createRuntimeDnsRecords,
				{ ipv4: "1.2.3.4", ipv6: "2a01::1", slug: "atlas" }
			)
		).rejects.toThrow("Invalid Cloudflare response at 0.id");
	});

	test("updates a stale address and creates the missing address", async () => {
		const fetch = queuedFetch(
			{ body: { success: true, result: [record("old", "A", "9.9.9.9")] } },
			{ body: { success: true, result: record("a", "A", "1.2.3.4") } },
			{ body: { success: true, result: [] } },
			{
				body: {
					success: true,
					result: record("aaaa", "AAAA", "2a01::1")
				}
			}
		);

		await expect(
			testConvex().action(
				internal.fleet.infra.cloudflareDns.createRuntimeDnsRecords,
				{ ipv4: "1.2.3.4", ipv6: "2a01::1", slug: "atlas" }
			)
		).resolves.toEqual({ aRecordId: "a", aaaaRecordId: "aaaa" });
		expect(fetch.mock.calls[1][1]).toMatchObject({ method: "PATCH" });
		expect(fetch.mock.calls[3][1]).toMatchObject({ method: "POST" });
	});

	test("deletes every recorded address and accepts one already being absent", async () => {
		const fetch = queuedFetch(
			{
				body: { success: false, errors: [{ message: "not found" }] },
				status: 404
			},
			{ body: { result: { id: "aaaa" } } }
		);

		await expect(
			testConvex().action(
				internal.fleet.infra.cloudflareDns.deleteRuntimeDnsRecords,
				{ aRecordId: "a", aaaaRecordId: "aaaa" }
			)
		).resolves.toBeNull();
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
