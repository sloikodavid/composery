import { type Infer, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import {
	type AllocationPartStatus,
	allocationPartStatus,
	allocationParts,
} from "../allocations/schema";
import type { ServerAccess } from "./permissions";
import { serverPermissions } from "./schema";

export const serverPart = v.union(
	v.literal("server"),
	v.literal("addresses"),
	v.literal("firewall"),
	v.literal("managementAccess"),
);

export const serverParts = v.object({
	...allocationParts.fields,
	managementAccess: allocationPartStatus,
});

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

export const serverFeature = v.object({
	status: v.union(
		v.literal("available"),
		v.literal("unavailable"),
		v.literal("unknown"),
	),
	because: v.optional(serverPart),
});

export const serverFeatures = v.object({
	power: serverFeature,
	sshKeys: serverFeature,
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
		sshKeys:
			server.status === "available"
				? toFeature("managementAccess", parts.managementAccess)
				: server,
		deletion: { status: "available" },
	};
}
