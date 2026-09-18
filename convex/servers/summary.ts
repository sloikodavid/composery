import { type Infer, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import {
	type AllocationPartStatus,
	allocationPartStatus,
	allocationParts,
} from "../allocations/schema";
import type { ServerAccess } from "./permissions";
import { serverPermissions } from "./schema";

/** Every part of a server that something can be said about, ours as well as the backend's. */
export const serverPart = v.union(
	v.literal("server"),
	v.literal("addresses"),
	v.literal("firewall"),
	v.literal("managementAccess"),
);

export const serverParts = v.object({
	...allocationParts.fields,
	/** What Composery's own way in looked like the last time anything used it. */
	managementAccess: allocationPartStatus,
});

/** What a server is to a user who may see it: its name, and what they may do with it. */
export const serverSummary = v.object({
	_id: v.id("servers"),
	name: v.string(),
	isOwner: v.boolean(),
	permissions: serverPermissions,
});

export function toServerSummary(
	server: Doc<"servers">,
	access: ServerAccess,
): Infer<typeof serverSummary> {
	return {
		_id: server._id,
		name: server.name,
		isOwner: access.isOwner,
		permissions: access.permissions,
	};
}

/**
 * What a member can do with a server right now, and when they cannot, which part of it is the
 * reason. Every rule is here once: a caller that worked it out from the parts itself would be a
 * second copy of the rules, and the two would disagree the first time one part changed meaning.
 */
export const serverFeature = v.object({
	status: v.union(
		v.literal("available"),
		v.literal("unavailable"),
		v.literal("unknown"),
	),
	/** The part that is the reason, when the answer is not simply yes. */
	because: v.optional(serverPart),
});

export const serverFeatures = v.object({
	/** Starting and stopping, which goes through the provider and needs nothing inside the server. */
	power: serverFeature,
	/** Reading and changing the keys on the server, which needs Composery's own way in. */
	sshKeys: serverFeature,
	/** Deleting the server, which is always allowed: it is the one thing a broken part cannot stop. */
	deletion: serverFeature,
});

function toFeature(
	part: Infer<typeof serverPart>,
	status: AllocationPartStatus,
): Infer<typeof serverFeature> {
	if (status === "ok") {
		return { status: "available" };
	}
	return {
		status: status === "unknown" ? "unknown" : "unavailable",
		because: part,
	};
}

export function toServerFeatures(
	parts: Infer<typeof serverParts>,
): Infer<typeof serverFeatures> {
	const server = toFeature("server", parts.server);
	return {
		power: server,
		// Signing in needs the server to be there as well as a way in, so the server answers first.
		sshKeys:
			server.status === "available"
				? toFeature("managementAccess", parts.managementAccess)
				: server,
		deletion: { status: "available" },
	};
}
