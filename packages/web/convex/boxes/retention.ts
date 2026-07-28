// runbook: Deleted box/support evidence
export const DELETED_BOX_RETENTION_DAYS = 180;
export const DELETED_BOX_RETENTION_MS =
	DELETED_BOX_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export function deletedBoxPurgeAt(deletedAt: number) {
	return deletedAt + DELETED_BOX_RETENTION_MS;
}

export function deletedBoxDataPatch(deletedAt: number) {
	return {
		status: "deleted" as const,
		runtime_image: undefined,
		runtime_auth_hash: undefined,
		password_setup_pending_at: undefined,
		hetzner_server_id: undefined,
		hetzner_server_type: undefined,
		hetzner_location: undefined,
		hetzner_ipv4: undefined,
		hetzner_ipv6: undefined,
		dns_record_id: undefined,
		dns_record_aaaa_id: undefined,
		parking_volume_id: undefined,
		parking_volume_stage: undefined,
		deleted_at: deletedAt,
		purge_at: deletedBoxPurgeAt(deletedAt)
	};
}

// runbook: Unpaid checkout record
export const UNPAID_CHECKOUT_RETENTION_DAYS = 30;
export const UNPAID_CHECKOUT_RETENTION_MS =
	UNPAID_CHECKOUT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
// runbook: Paid billing record
export const BILLING_RECORD_RETENTION_YEARS = 6;

export function unpaidCheckoutPurgeAt(finishedAt: number) {
	return finishedAt + UNPAID_CHECKOUT_RETENTION_MS;
}

export function billingRecordPurgeAt(finishedAt: number) {
	const date = new Date(finishedAt);
	date.setUTCFullYear(date.getUTCFullYear() + BILLING_RECORD_RETENTION_YEARS);
	return date.getTime();
}

// The reason a suspension recorded, narrowed out of free-form operation
// metadata. Two readers need the same answer - what survives a box's deletion,
// and what the owner is told when the suspension happens - and one of them puts
// it in an email, so a value that is not a usable string has to be nothing in
// both rather than reach an inbox as "[object Object]".
export function suspensionReason(
	metadata: Record<string, unknown> | undefined
) {
	const reason = metadata?.reason;
	return typeof reason === "string" && reason.trim() ? reason : undefined;
}

export function retainedOperationMetadata(
	type: string,
	metadata: Record<string, unknown> | undefined
) {
	const reason = type === "suspend" ? suspensionReason(metadata) : undefined;
	return reason ? { reason } : undefined;
}

export function terminalCheckoutSecretPatch() {
	return {
		polar_checkout_url: undefined,
		runtime_auth_hash: undefined
	};
}

export function deletedCheckoutSlug(intentId: string) {
	return `deleted-${intentId}`;
}
