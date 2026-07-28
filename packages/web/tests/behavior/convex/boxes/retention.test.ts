import { describe, expect, test } from "vitest";
import {
	BILLING_RECORD_RETENTION_YEARS,
	DELETED_BOX_RETENTION_DAYS,
	billingRecordPurgeAt,
	deletedBoxDataPatch,
	deletedBoxPurgeAt,
	retainedOperationMetadata,
	terminalCheckoutSecretPatch,
	unpaidCheckoutPurgeAt
} from "@/convex/boxes/retention";

describe("box retention", () => {
	test("keeps a deleted box audit tombstone for exactly 180 days", () => {
		const deletedAt = Date.UTC(2026, 0, 1);
		expect(DELETED_BOX_RETENTION_DAYS).toBe(180);
		expect(deletedBoxPurgeAt(deletedAt)).toBe(
			Date.UTC(2026, 0, 1) + 180 * 24 * 60 * 60 * 1000
		);
	});

	test("removes secrets and dead infrastructure from the tombstone", () => {
		const deletedAt = Date.UTC(2026, 0, 1);
		expect(deletedBoxDataPatch(deletedAt)).toMatchObject({
			status: "deleted",
			runtime_image: undefined,
			runtime_auth_hash: undefined,
			password_setup_pending_at: undefined,
			hetzner_server_id: undefined,
			hetzner_ipv4: undefined,
			dns_record_id: undefined,
			deleted_at: deletedAt,
			purge_at: deletedBoxPurgeAt(deletedAt)
		});
	});

	test("removes unpaid checkout records after 30 days", () => {
		const finishedAt = Date.UTC(2026, 0, 1);
		expect(unpaidCheckoutPurgeAt(finishedAt)).toBe(Date.UTC(2026, 0, 31));
	});

	test("uses calendar years for statutory billing retention", () => {
		const finishedAt = Date.UTC(2024, 1, 29, 12);
		expect(BILLING_RECORD_RETENTION_YEARS).toBe(6);
		expect(billingRecordPurgeAt(finishedAt)).toBe(Date.UTC(2030, 2, 1, 12));
	});

	test("retains only a manual suspension reason from operation metadata", () => {
		expect(
			retainedOperationMetadata("suspend", {
				reason: "Repeated outbound abuse",
				secret: "drop-me"
			})
		).toEqual({ reason: "Repeated outbound abuse" });
		expect(
			retainedOperationMetadata("change_slug", {
				oldSlug: "old",
				newSlug: "new"
			})
		).toBeUndefined();
	});

	test("removes checkout secrets as soon as an intent becomes terminal", () => {
		expect(terminalCheckoutSecretPatch()).toEqual({
			polar_checkout_url: undefined,
			runtime_auth_hash: undefined
		});
	});
});
