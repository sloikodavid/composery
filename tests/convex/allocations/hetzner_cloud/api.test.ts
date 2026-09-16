import { expect, test } from "bun:test";
import { hetznerContract } from "../../../../contracts/hetzner";
import {
	isUsable,
	toServer,
} from "../../../../convex/allocations/hetzner_cloud/api";
import { toServerReply } from "../../../harness/hetzner/replies";

/**
 * Reading a server Hetzner describes. The shapes here are not invented: each one is put through
 * Hetzner's own published description first, so a test cannot pass by asking our code to read
 * something Hetzner would never send.
 */

const serverId = 1005;
const firewallId = 77;
const imageId = 501;
const httpOk = 200;

function toReply(
	addresses: Partial<
		Pick<Parameters<typeof toServerReply>[0], "ipv4" | "ipv6" | "firewallId">
	> = {},
) {
	const reply = toServerReply({
		id: serverId,
		name: "one",
		status: "running",
		labels: {},
		ipv4: { id: 1001, ip: "203.0.113.1" },
		ipv6: { id: 1003, ip: "2001:db8::1" },
		firewallId,
		serverType: "cx23",
		location: "nbg1",
		imageId,
		imageName: "ubuntu-24.04",
		...addresses,
	});
	// Hetzner's description decides whether it could have sent this.
	expect(
		hetznerContract.listReplyProblems("GET", `/servers/${serverId}`, httpOk, {
			server: reply,
		}),
	).toEqual([]);
	return reply;
}

test("a server with both addresses reads as both addresses", () => {
	const server = toServer(toReply());
	expect(server.ipv4).toEqual({ id: 1001, address: "203.0.113.1" });
	expect(server.ipv6).toEqual({ id: 1003, address: "2001:db8::1" });
	expect(server.status).toBe("running");
});

test("a server whose address was deleted reads as having none of that kind", () => {
	// Hetzner lets an address be deleted while the server is off, and then sends null here. Reading
	// that as a reply we cannot understand would hide a real change behind the wrong failure.
	const withoutIpv4 = toServer(toReply({ ipv4: null }));
	expect(withoutIpv4.ipv4).toBe(null);
	expect(withoutIpv4.ipv6).toEqual({ id: 1003, address: "2001:db8::1" });

	const withoutIpv6 = toServer(toReply({ ipv6: null }));
	expect(withoutIpv6.ipv6).toBe(null);
	expect(withoutIpv6.ipv4).toEqual({ id: 1001, address: "203.0.113.1" });
});

test("a server whose firewall was detached reads as having none", () => {
	// Hetzner requires `ipv4`, `ipv6` and `floating_ips` in a public network, and not `firewalls`.
	// An admin who removes the firewall in Hetzner's console produces exactly this.
	const server = toServer(toReply({ firewallId: null }));
	expect(server.firewalls).toEqual([]);
});

test("an address Hetzner does not number cannot be matched, and says so as one", () => {
	// `id` is not required inside a public network. Without it there is nothing to compare against
	// the Primary IP this allocation recorded, which is a mismatch rather than an unreadable reply.
	const server = toServer(toReply({ ipv4: { ip: "203.0.113.1" } }));
	expect(server.ipv4).toBe(null);
});

test("a deprecation that has only been announced does not make a thing unusable", () => {
	const day = 86_400_000;
	const future = new Date(Date.now() + day).toISOString();
	const past = new Date(Date.now() - day).toISOString();

	expect(isUsable(null)).toBe(true);
	expect(isUsable(undefined)).toBe(true);
	// Hetzner announces months ahead. Refusing on the announcement would fail every new server on
	// a date Hetzner picks, with nothing yet actually gone.
	// biome-ignore-start lint/style/useNamingConvention: the Hetzner Cloud API names these fields
	expect(isUsable({ announced: past, unavailable_after: future })).toBe(true);
	expect(isUsable({ announced: past, unavailable_after: past })).toBe(false);
	// biome-ignore-end lint/style/useNamingConvention: the Hetzner Cloud API names these fields
});
