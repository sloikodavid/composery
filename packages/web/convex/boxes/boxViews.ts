import type { Doc } from "../_generated/dataModel";
import { cloudUrl } from "../env";

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
		polarSubscriptionId: box.polar_subscription_id
	};
}

export function staffBox(box: Doc<"boxes">, user?: Doc<"users"> | null) {
	return {
		...safeBox(box),
		userId: box.user_id,
		userEmail: user?.email ?? "",
		polarCustomerId: box.polar_customer_id,
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
