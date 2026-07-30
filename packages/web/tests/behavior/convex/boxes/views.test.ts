import { afterEach, describe, expect, test } from "vitest";
import type { Doc } from "@/convex/_generated/dataModel";
import { safeBox, staffBox } from "@/convex/boxes/views";
import { resolveSnapshotSplit } from "@/lib/box-plan";

const previousDomain = process.env.CLOUD_DOMAIN;
afterEach(() => {
	if (previousDomain === undefined) delete process.env.CLOUD_DOMAIN;
	else process.env.CLOUD_DOMAIN = previousDomain;
});

function box(overrides: Partial<Doc<"boxes">> = {}): Doc<"boxes"> {
	return {
		_id: "boxes:1" as Doc<"boxes">["_id"],
		_creationTime: 1,
		user_id: "user_1",
		slug: "my-box",
		plan: "air" as const,
		manual_snapshot_cap: 0,
		status: "running",
		polar_customer_id: "cust_1",
		polar_subscription_id: "sub_1",
		runtime_image: "ghcr.io/app:tag",
		runtime_auth_hash: "$argon2id$hash",
		created_at: 1_000,
		updated_at: 2_000,
		...overrides
	} as Doc<"boxes">;
}

describe("safeBox", () => {
	// Exhaustive on purpose. This object is what every box list ships to a
	// browser, so a field added to it has to be added here too - which is the
	// moment to ask whether the owner's page reads it or only the console does.
	test("sends the owner exactly the fields their pages render", () => {
		process.env.CLOUD_DOMAIN = "composery.cloud";
		expect(safeBox(box())).toEqual({
			id: "boxes:1",
			slug: "my-box",
			status: "running",
			runtimeUrl: "https://my-box.composery.cloud/ide/",
			createdAt: 1_000,
			comp: false,
			plan: "air",
			snapshots: resolveSnapshotSplit("air", 0)
		});
	});

	// Billing identifiers and retention dates belong to the console. Nothing on
	// the owner's own pages reads them, and a subscription id is not something to
	// hand a browser for every row of a list just because the row's owner is
	// entitled to it.
	test("keeps billing and retention detail out of the owner's payload", () => {
		process.env.CLOUD_DOMAIN = "composery.cloud";
		const view = safeBox(
			box({ ready_at: 1_500, deleted_at: 9_000, purge_at: 12_000 })
		) as Record<string, unknown>;
		for (const field of [
			"polarSubscriptionId",
			"purgeAt",
			"deletedAt",
			"readyAt",
			"updatedAt",
			"runtimeVersion"
		]) {
			expect(view).not.toHaveProperty(field);
		}
	});

	test("marks a comp box and nulls its absent subscription for staff", () => {
		process.env.CLOUD_DOMAIN = "composery.cloud";
		const overrides = {
			polar_customer_id: undefined,
			polar_subscription_id: undefined,
			comped_by: "user_staff",
			comped_at: 5_000,
			comp_reason: "beta tester"
		};
		expect(safeBox(box(overrides)).comp).toBe(true);
		const staff = staffBox(box(overrides));
		expect(staff.polarSubscriptionId).toBeNull();
		expect(staff.polarCustomerId).toBeNull();
		expect(staff.compedBy).toBe("user_staff");
		expect(staff.compReason).toBe("beta tester");
	});

	test("keeps a deleted box's status but drops its unreachable url for staff", () => {
		process.env.CLOUD_DOMAIN = "composery.cloud";
		const staff = staffBox(
			box({ deleted_at: 9_000, purge_at: 12_000, status: "deleted" })
		);
		expect(staff.status).toBe("deleted");
		expect(staff.deletedAt).toBe(9_000);
		expect(staff.purgeAt).toBe(12_000);
		expect(staff.runtimeUrl).toBeNull();
	});
});

describe("staffBox", () => {
	test("extends safeBox with infra + owner fields, falling back to empty email", () => {
		process.env.CLOUD_DOMAIN = ".composery.cloud.";
		const view = staffBox(
			box({
				hetzner_server_id: 42,
				hetzner_server_type: "cx23",
				hetzner_location: "nbg1",
				hetzner_ipv4: "203.0.113.1",
				hetzner_ipv6: "2001:db8::1/64",
				dns_record_id: "rec-a",
				dns_record_aaaa_id: "rec-aaaa"
			})
		);
		expect(view.runtimeUrl).toBe("https://my-box.composery.cloud/ide/");
		expect(view.userId).toBe("user_1");
		expect(view.userEmail).toBe("");
		expect(view.hetznerServerId).toBe(42);
		expect(view.hetznerServerType).toBe("cx23");
		expect(view.hetznerLocation).toBe("nbg1");
		expect(view.hetznerIpv4).toBe("203.0.113.1");
		expect(view.dnsRecordId).toBe("rec-a");
	});

	test("attaches the owner email when the user row is supplied", () => {
		process.env.CLOUD_DOMAIN = "composery.cloud";
		const view = staffBox(box(), {
			_id: "users:1" as never,
			_creationTime: 1,
			clerk_user_id: "user_1",
			email: "name@example.com",
			role: "user",
			suspended: false,
			created_at: 0,
			updated_at: 0
		} as Doc<"users">);
		expect(view.userEmail).toBe("name@example.com");
	});
});
