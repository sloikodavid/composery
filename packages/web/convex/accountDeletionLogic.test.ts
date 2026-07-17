import { describe, expect, it } from "vitest";
import {
	accountDeletionBoxTargets,
	accountDeletionReady,
	boxDeletionIdempotencyKey,
	deletionIdempotencyKey,
	scrubbedAccountEmail,
	scrubbedUserId
} from "./accountDeletionLogic";

describe("accountDeletionBoxTargets", () => {
	it("targets only boxes that have not finished deleting", () => {
		const boxes = [
			{ polar_subscription_id: "sub_running", status: "running" },
			{ polar_subscription_id: "sub_deleting", status: "deleting" },
			{ polar_subscription_id: "sub_deleted", status: "deleted" },
			{ polar_subscription_id: "sub_failed", status: "delete_failed" }
		];

		expect(accountDeletionBoxTargets(boxes)).toEqual([
			boxes[0],
			boxes[1],
			boxes[3]
		]);
	});
});

describe("deletionIdempotencyKey", () => {
	it("matches the subscription deletion key used by webhooks and sweeps", () => {
		expect(deletionIdempotencyKey("sub_123")).toBe("delete:sub_123");
	});
});

describe("boxDeletionIdempotencyKey", () => {
	it("keys a paid box on its subscription", () => {
		expect(
			boxDeletionIdempotencyKey({
				_id: "boxes:1",
				polar_subscription_id: "sub_123"
			})
		).toBe("delete:sub_123");
	});

	it("keys a comp box on its id, since it has no subscription", () => {
		expect(boxDeletionIdempotencyKey({ _id: "boxes:9" })).toBe(
			"delete:boxes:9"
		);
	});
});

describe("accountDeletionReady", () => {
	it("is ready when every box has reached deleted", () => {
		expect(
			accountDeletionReady([
				{ polar_subscription_id: "sub_1", status: "deleted" },
				{ polar_subscription_id: "sub_2", status: "deleted" }
			])
		).toBe(true);
	});

	it("is also ready for users with no boxes", () => {
		expect(accountDeletionReady([])).toBe(true);
	});

	it("waits while any box is still tearing down or retryable", () => {
		expect(
			accountDeletionReady([
				{ polar_subscription_id: "sub_1", status: "deleted" },
				{ polar_subscription_id: "sub_2", status: "delete_failed" }
			])
		).toBe(false);
	});
});

describe("scrubbedAccountEmail", () => {
	it("derives a stable non-PII placeholder from an internal id", () => {
		expect(scrubbedAccountEmail("users:abc123")).toBe(
			"deleted-user-users-abc123@deleted.invalid"
		);
	});
});

describe("scrubbedUserId", () => {
	it("replaces the external identity with an internal pseudonym", () => {
		expect(scrubbedUserId("users:abc123")).toBe("deleted:users:abc123");
	});
});
