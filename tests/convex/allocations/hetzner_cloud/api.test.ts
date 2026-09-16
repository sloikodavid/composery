import { expect, test } from "bun:test";
import { hetznerContract } from "../../../../contracts/hetzner";
import { toServer } from "../../../../convex/allocations/hetzner_cloud/api";
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
		Pick<Parameters<typeof toServerReply>[0], "ipv4" | "ipv6">
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
