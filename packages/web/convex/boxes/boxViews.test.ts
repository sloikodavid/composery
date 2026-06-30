import { afterEach, describe, expect, it } from "vitest";
import type { Doc } from "../_generated/dataModel";
import { safeBox, staffBox } from "./boxViews";

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
	it("maps the owner-facing fields and derives the runtime url", () => {
		process.env.CLOUD_DOMAIN = "composery.cloud";
		const view = safeBox(box());
		expect(view).toEqual({
			id: "boxes:1",
			slug: "my-box",
			status: "running",
			runtimeUrl: "https://my-box.composery.cloud/",
			createdAt: 1_000,
			updatedAt: 2_000,
			provisionedAt: undefined,
			deletedAt: undefined,
			polarSubscriptionId: "sub_1"
		});
	});

	it("surfaces provisioned/deleted timestamps when present", () => {
		process.env.CLOUD_DOMAIN = "composery.cloud";
		const view = safeBox(
			box({ provisioned_at: 1_500, deleted_at: 9_000, status: "deleted" })
		);
		expect(view.provisionedAt).toBe(1_500);
		expect(view.deletedAt).toBe(9_000);
		expect(view.status).toBe("deleted");
	});
});

describe("staffBox", () => {
	it("extends safeBox with infra + owner fields, falling back to empty email", () => {
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
		expect(view.runtimeUrl).toBe("https://my-box.composery.cloud/");
		expect(view.userId).toBe("user_1");
		expect(view.userEmail).toBe("");
		expect(view.hetznerServerId).toBe(42);
		expect(view.hetznerServerType).toBe("cx23");
		expect(view.hetznerLocation).toBe("nbg1");
		expect(view.hetznerIpv4).toBe("203.0.113.1");
		expect(view.dnsRecordId).toBe("rec-a");
	});

	it("attaches the owner email when the user row is supplied", () => {
		process.env.CLOUD_DOMAIN = "composery.cloud";
		const view = staffBox(box(), {
			_id: "users:1" as never,
			_creationTime: 1,
			clerk_user_id: "user_1",
			email: "owner@example.com",
			role: "user",
			suspended: false,
			created_at: 0,
			updated_at: 0
		} as Doc<"users">);
		expect(view.userEmail).toBe("owner@example.com");
	});
});
