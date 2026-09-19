import { expect, test } from "bun:test";
import { createHetznerContractChecker } from "../../../../contracts/hetzner";
import {
	HetznerCloudError,
	isUsable,
	requireOfferedServerType,
	requireOwnedResource,
	toServer,
} from "../../../../convex/allocations/hetzner_cloud/api";
import {
	toFirewallReply,
	toPaginationReply,
	toServerReply,
	toServerTypeReply,
} from "../../../../harness/hetzner/replies";

const serverId = 1005;
const firewallId = 77;
const imageId = 501;
const httpOk = 200;
const controllerId = "composery-test";

// Replies are checked against Hetzner's contract before the parser sees them.

const hetznerContract = createHetznerContractChecker();

function catchHetznerError(run: () => unknown) {
	try {
		run();
	} catch (error) {
		if (error instanceof HetznerCloudError) {
			return error;
		}
		throw error;
	}
	return null;
}

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
	// Hetzner reports a deleted Primary IP as null while the server remains valid.
	const withoutIpv4 = toServer(toReply({ ipv4: null }));
	expect(withoutIpv4.ipv4).toBe(null);
	expect(withoutIpv4.ipv6).toEqual({ id: 1003, address: "2001:db8::1" });

	const withoutIpv6 = toServer(toReply({ ipv6: null }));
	expect(withoutIpv6.ipv6).toBe(null);
	expect(withoutIpv6.ipv4).toEqual({ id: 1001, address: "203.0.113.1" });
});

test("a server whose firewall was detached reads as having none", () => {
	// A detached firewall is an external change, not an unreadable provider reply.
	const server = toServer(toReply({ firewallId: null }));
	expect(server.firewalls).toEqual([]);
});

test("an address Hetzner does not number cannot be matched, and says so as one", () => {
	// Without the Primary IP ID, the address cannot be matched to this allocation.
	const server = toServer(toReply({ ipv4: { ip: "203.0.113.1" } }));
	expect(server.ipv4).toBe(null);
});

test("a deprecation that has only been announced does not make a thing unusable", () => {
	const day = 86_400_000;
	const future = new Date(Date.now() + day).toISOString();
	const past = new Date(Date.now() - day).toISOString();

	expect(isUsable(null)).toBe(true);
	expect(isUsable(undefined)).toBe(true);
	// Announcement is not unavailability; only the provider's cutoff makes it unusable.
	// biome-ignore-start lint/style/useNamingConvention: external field names
	expect(isUsable({ announced: past, unavailable_after: future })).toBe(true);
	expect(isUsable({ announced: past, unavailable_after: past })).toBe(false);
	// biome-ignore-end lint/style/useNamingConvention: external field names
});

test("a server type Hetzner no longer offers is refused for good, not read as a broken reply", () => {
	const offered = {
		// biome-ignore lint/style/useNamingConvention: external field name
		server_types: [toServerTypeReply("cx23", ["nbg1"])],
		meta: toPaginationReply(1),
	};
	const retired = {
		// biome-ignore lint/style/useNamingConvention: external field name
		server_types: [],
		meta: toPaginationReply(0),
	};
	for (const reply of [offered, retired]) {
		expect(
			hetznerContract.listReplyProblems("GET", "/server_types", httpOk, reply),
		).toEqual([]);
	}

	expect(requireOfferedServerType(offered, "cx23").name).toBe("cx23");
	const refusal = catchHetznerError(() =>
		requireOfferedServerType(retired, "cx23"),
	);
	expect(refusal?.code).toBe("server_type_unavailable");
	expect(refusal?.failureClass).toBe("waiting");
});

test("a firewall without our label is not ours, and says so", () => {
	const labelled = toFirewallReply(firewallId, controllerId);
	const { labels: _, ...unlabelled } = labelled;
	for (const firewall of [labelled, unlabelled]) {
		expect(
			hetznerContract.listReplyProblems(
				"GET",
				`/firewalls/${firewallId}`,
				httpOk,
				{
					firewall,
				},
			),
		).toEqual([]);
	}

	expect(
		catchHetznerError(() => requireOwnedResource(labelled, controllerId)),
	).toBe(null);
	expect(
		catchHetznerError(() => requireOwnedResource(unlabelled, controllerId))
			?.code,
	).toBe("resource_identity_mismatch");
});
