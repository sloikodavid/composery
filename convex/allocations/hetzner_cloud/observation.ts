import { type Infer, v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import type { allocationParts } from "../schema";

export const hetznerCloudServerState = v.object({
	id: v.number(),
	status: v.union(
		v.literal("running"),
		v.literal("stopped"),
		v.literal("changing"),
	),
	// A deleted Primary IP is reported as null while the server remains observable.
	ipv4: v.union(v.object({ id: v.number(), address: v.string() }), v.null()),
	ipv6: v.union(v.object({ id: v.number(), address: v.string() }), v.null()),
	serverType: v.string(),
	location: v.string(),
	firewalls: v.array(v.object({ id: v.number(), isApplied: v.boolean() })),
});

export type HetznerCloudServer = Infer<typeof hetznerCloudServerState>;

export type ServerObservation = Readonly<{
	parts: Infer<typeof allocationParts>;
	addresses: { ipv4?: string; ipv6?: string };
}>;

/** A missing or unapplied firewall is a repairable part failure, not a missing server. */
function toFirewallPart(
	firewall: HetznerCloudServer["firewalls"][number] | undefined,
) {
	if (firewall === undefined) {
		return "missing" as const;
	}
	return firewall.isApplied ? ("ok" as const) : ("unknown" as const);
}

/** Returns null for a different server; otherwise reports each owned part independently. */
export function observeHetznerCloudServer(
	allocation: Doc<"hetznerCloudAllocations">,
	server: HetznerCloudServer,
): ServerObservation | null {
	const { resources, spec, firewallId } = allocation;
	if (
		server.serverType !== spec?.serverType ||
		server.location !== spec?.location
	) {
		return null;
	}
	const recorded = {
		ipv4: resources.ipv4.status === "present" ? resources.ipv4.id : 0,
		ipv6: resources.ipv6.status === "present" ? resources.ipv6.id : 0,
	};
	const keptAddresses =
		server.ipv4?.id === recorded.ipv4 && server.ipv6?.id === recorded.ipv6;
	return {
		parts: {
			server: "ok",
			addresses: keptAddresses ? "ok" : "mismatch",
			firewall: toFirewallPart(
				server.firewalls.find((attached) => attached.id === firewallId),
			),
		},
		addresses: {
			...(keptAddresses && server.ipv4 !== null
				? { ipv4: server.ipv4.address }
				: {}),
			...(keptAddresses && server.ipv6 !== null
				? { ipv6: server.ipv6.address }
				: {}),
		},
	};
}
