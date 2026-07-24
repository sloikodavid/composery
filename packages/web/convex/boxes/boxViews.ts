import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import { cloudUrl } from "../env";

// Every other box operation moves the box into a visible status while it runs
// (stopping, resetting, ...). Repair deliberately does not - a broken box is
// still "running" - so this record is the only place a repair's progress and
// its failure exist. Both detail views read it, so they cannot disagree about
// what the owner and staff are told.
export async function latestRepair(
	db: DatabaseReader,
	boxId: Id<"boxes">
): Promise<{
	status: Doc<"box_operations">["status"];
	error: string | null;
	finishedAt: number | null;
} | null> {
	const operation = await db
		.query("box_operations")
		.withIndex("box_id_type_created_at", (query) =>
			query.eq("box_id", boxId).eq("type", "recover")
		)
		.order("desc")
		.first();
	if (!operation) return null;
	return {
		status: operation.status,
		error: operation.last_error ?? null,
		finishedAt: operation.finished_at ?? null
	};
}

export function safeBox(box: Doc<"boxes">) {
	return {
		id: box._id,
		slug: box.slug,
		status: box.status,
		runtimeUrl: cloudUrl(box.slug),
		createdAt: box.created_at,
		updatedAt: box.updated_at,
		provisionedAt: box.provisioned_at,
		deletedAt: box.deleted_at,
		purgeAt: box.purge_at,
		polarSubscriptionId: box.polar_subscription_id ?? null,
		comp: box.comped_at !== undefined
	};
}

export function staffBox(box: Doc<"boxes">, user?: Doc<"users"> | null) {
	return {
		...safeBox(box),
		runtimeUrl: box.status === "deleted" ? null : cloudUrl(box.slug),
		userId: box.user_id,
		userEmail: user?.email ?? "",
		polarCustomerId: box.polar_customer_id ?? null,
		compedBy: box.comped_by ?? null,
		compReason: box.comp_reason ?? null,
		runtimeImage: box.runtime_image,
		hetznerServerId: box.hetzner_server_id,
		hetznerServerType: box.hetzner_server_type,
		hetznerLocation: box.hetzner_location,
		hetznerIpv4: box.hetzner_ipv4,
		hetznerIpv6: box.hetzner_ipv6,
		dnsRecordId: box.dns_record_id,
		dnsRecordAaaaId: box.dns_record_aaaa_id
	};
}
