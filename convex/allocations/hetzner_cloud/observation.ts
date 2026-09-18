import { type Infer, v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import type { allocationParts } from "../schema";

/**
 * What one look at a server says about the allocation it belongs to. The worker looks at one
 * server because it is about to act on it; the inventory scan looks at every server anyway, a page
 * at a time. Both have the same question and it is answered here once.
 */

export const hetznerCloudServerState = v.object({
	id: v.number(),
	status: v.union(
		v.literal("running"),
		v.literal("stopped"),
		v.literal("changing"),
	),
	// Hetzner sends nothing for an address a server does not have, which somebody can arrange by
	// deleting the Primary IP while the server is off.
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

/**
 * Hetzner takes a few seconds to apply rules it has been given, so one on its way is not yet
 * anything to say about.
 */
function toFirewallPart(
	firewall: HetznerCloudServer["firewalls"][number] | undefined,
) {
	if (firewall === undefined) {
		return "missing" as const;
	}
	return firewall.isApplied ? ("ok" as const) : ("unknown" as const);
}

/**
 * What each part of this allocation looks like, in our own words. An address somebody detached, or
 * rules somebody took off, is a part that is not as it should be: it does not stop the server being
 * seen, and it does not stop what has nothing to do with it. A server of another type or in another
 * place is the one difference that stops the rest, because it is not the server we recorded.
 */
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
