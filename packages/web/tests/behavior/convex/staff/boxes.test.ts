import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

import {
	boxOperations,
	readBox,
	readOperation,
	seedBox,
	seedSettings,
	seedUser,
	stubDeploymentEnv,
	testConvex,
	type Harness
} from "../../../support/convex.ts";

// The staff console acts on boxes staff do not own, so every entry point here is
// a capability check with an operation behind it. The pair of questions each
// test asks is: does a customer get refused, and does the action a staff member
// takes carry their name?
const NOW = Date.UTC(2026, 8, 9, 10, 11, 12);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	stubDeploymentEnv();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

async function cast(t: Harness) {
	const admin = await seedUser(t, {
		clerkUserId: "admin",
		email: "admin@example.com",
		role: "admin"
	});
	const customer = await seedUser(t, {
		clerkUserId: "customer",
		email: "customer@example.com"
	});
	return { admin, customer };
}

describe("acting on a box as staff", () => {
	test("stops any box for a staff member with box powers", async () => {
		const t = testConvex();
		const { admin, customer } = await cast(t);
		const boxId = await seedBox(t, {
			user_id: customer.clerkUserId,
			status: "running"
		});

		await admin.as.mutation(api.staff.boxes.stop, { boxId });

		expect(await readBox(t, boxId)).toMatchObject({ status: "stopping" });
	});

	test("refuses the same call from the box's own owner", async () => {
		const t = testConvex();
		const { customer } = await cast(t);
		const boxId = await seedBox(t, {
			user_id: customer.clerkUserId,
			status: "running"
		});

		await expect(
			customer.as.mutation(api.staff.boxes.stop, { boxId })
		).rejects.toThrow(/Staff access required/);
		expect(await readBox(t, boxId)).toMatchObject({ status: "running" });
	});

	// Staff act on a box's behalf, so the operation is triggered by "staff" - and
	// automatic repair reads that field alone to decide a human is on the box.
	test("records a staff-triggered operation as staff, not owner", async () => {
		const t = testConvex();
		const { admin, customer } = await cast(t);
		const boxId = await seedBox(t, {
			user_id: customer.clerkUserId,
			status: "running"
		});

		await admin.as.mutation(api.staff.boxes.reset, { boxId });

		expect(await boxOperations(t, boxId)).toMatchObject([
			{ type: "reset", trigger: "staff" }
		]);
	});

	// The console deliberately bypasses the owner's weekly reissue cap, because a
	// support engineer resetting a broken box is not the case the cap is for.
	test("resets past the reissue budget the owner is held to", async () => {
		const t = testConvex();
		const { admin, customer } = await cast(t);
		const boxId = await seedBox(t, {
			user_id: customer.clerkUserId,
			slug: "spent",
			status: "running"
		});
		await t.run(async (ctx) => {
			for (let index = 0; index < 5; index += 1) {
				await ctx.db.insert("box_operations", {
					box_id: boxId,
					type: "reset",
					status: "succeeded",
					idempotency_key: `past-${index}`,
					trigger: "owner",
					created_at: NOW - 1000,
					updated_at: NOW - 1000
				});
			}
		});

		await admin.as.mutation(api.staff.boxes.reset, { boxId });

		expect(await readBox(t, boxId)).toMatchObject({ status: "resetting" });
	});

	test("suspends a box on a staff member's say-so and keeps the reason", async () => {
		const t = testConvex();
		const { admin, customer } = await cast(t);
		const boxId = await seedBox(t, {
			user_id: customer.clerkUserId,
			status: "running"
		});

		await admin.as.action(api.staff.boxes.suspend, {
			boxId,
			reason: "egress abuse"
		});

		expect(await boxOperations(t, boxId)).toMatchObject([
			{
				type: "suspend",
				trigger: "staff",
				metadata: { reason: "egress abuse" }
			}
		]);
	});

	test("refuses a suspension to a customer", async () => {
		const t = testConvex();
		const { customer } = await cast(t);
		const boxId = await seedBox(t, {
			user_id: customer.clerkUserId,
			status: "running"
		});

		await expect(
			customer.as.action(api.staff.boxes.suspend, { boxId })
		).rejects.toThrow(/Staff access required/);
		expect(await boxOperations(t, boxId)).toEqual([]);
	});
});

// Cancelling is the lever a person pulls on a wedged operation, and the one
// place staff can end an operation that is still nominally alive.
describe("cancelling a wedged operation", () => {
	async function openOperation(t: Harness, boxId: Id<"boxes">) {
		return await t.run(
			async (ctx) =>
				await ctx.db.insert("box_operations", {
					box_id: boxId,
					type: "repair",
					status: "running",
					idempotency_key: `repair:${boxId}`,
					trigger: "owner",
					created_at: NOW - 1000,
					updated_at: NOW - 1000
				})
		);
	}

	test("closes the operation and frees the box", async () => {
		const t = testConvex();
		const { admin, customer } = await cast(t);
		const boxId = await seedBox(t, {
			user_id: customer.clerkUserId,
			status: "repairing"
		});
		const operationId = await openOperation(t, boxId);

		await admin.as.action(api.staff.boxes.cancelOperation, { boxId });

		expect(await readOperation(t, operationId)).toMatchObject({
			status: "failed"
		});
		expect(await readBox(t, boxId)).toMatchObject({ status: "repair_failed" });
	});

	test("says so when the box has nothing in progress", async () => {
		const t = testConvex();
		const { admin, customer } = await cast(t);
		const boxId = await seedBox(t, { user_id: customer.clerkUserId });

		await expect(
			admin.as.action(api.staff.boxes.cancelOperation, { boxId })
		).rejects.toThrow(/no operation in progress/);
	});

	test("refuses a cancellation to a customer", async () => {
		const t = testConvex();
		const { customer } = await cast(t);
		const boxId = await seedBox(t, {
			user_id: customer.clerkUserId,
			status: "repairing"
		});
		const operationId = await openOperation(t, boxId);

		await expect(
			customer.as.action(api.staff.boxes.cancelOperation, { boxId })
		).rejects.toThrow(/Staff access required/);
		expect(await readOperation(t, operationId)).toMatchObject({
			status: "running"
		});
	});
});

describe("dismissing a failure", () => {
	async function failedOperation(t: Harness, boxId: Id<"boxes">) {
		return await t.run(
			async (ctx) =>
				await ctx.db.insert("box_operations", {
					box_id: boxId,
					type: "reset",
					status: "failed",
					idempotency_key: `reset:${boxId}`,
					trigger: "owner",
					last_error: "boom",
					created_at: NOW - 1000,
					updated_at: NOW - 1000
				})
		);
	}

	// `requireCapability` hands the staff row back so callers can attribute the
	// action; the dismissal is where that attribution is stored.
	test("records which staff member dismissed the failure", async () => {
		const t = testConvex();
		const { admin, customer } = await cast(t);
		const boxId = await seedBox(t, { user_id: customer.clerkUserId });
		const operationId = await failedOperation(t, boxId);

		await admin.as.mutation(api.staff.boxes.dismissFailedOperation, {
			operationId
		});

		expect(await readOperation(t, operationId)).toMatchObject({
			dismissed_at: NOW,
			dismissed_by: admin.clerkUserId
		});
	});

	// A dismissal is a note about a failure, not a way to close a live operation.
	test("leaves an operation that has not failed alone", async () => {
		const t = testConvex();
		const { admin, customer } = await cast(t);
		const boxId = await seedBox(t, { user_id: customer.clerkUserId });
		const operationId = await t.run(
			async (ctx) =>
				await ctx.db.insert("box_operations", {
					box_id: boxId,
					type: "reset",
					status: "running",
					idempotency_key: `reset:${boxId}`,
					trigger: "owner",
					created_at: NOW,
					updated_at: NOW
				})
		);

		await admin.as.mutation(api.staff.boxes.dismissFailedOperation, {
			operationId
		});

		const operation = await readOperation(t, operationId);
		expect(operation?.dismissed_at).toBeUndefined();
	});

	test("keeps the first dismissal when the same failure is dismissed twice", async () => {
		const t = testConvex();
		const { admin, customer } = await cast(t);
		const boxId = await seedBox(t, { user_id: customer.clerkUserId });
		const operationId = await failedOperation(t, boxId);
		await admin.as.mutation(api.staff.boxes.dismissFailedOperation, {
			operationId
		});

		const second = await seedUser(t, {
			clerkUserId: "admin_2",
			email: "admin2@example.com",
			role: "admin"
		});
		await second.as.mutation(api.staff.boxes.dismissFailedOperation, {
			operationId
		});

		expect(await readOperation(t, operationId)).toMatchObject({
			dismissed_by: admin.clerkUserId
		});
	});

	test("refuses a dismissal to a customer", async () => {
		const t = testConvex();
		const { customer } = await cast(t);
		const boxId = await seedBox(t, { user_id: customer.clerkUserId });
		const operationId = await failedOperation(t, boxId);

		await expect(
			customer.as.mutation(api.staff.boxes.dismissFailedOperation, {
				operationId
			})
		).rejects.toThrow(/Staff access required/);
	});
});

// Minting a free box creates real infrastructure that costs money, which is why
// it gates on its own capability rather than on general box powers.
describe("comping a box", () => {
	beforeEach(() => {
		vi.stubEnv("RUNTIME_IMAGE", "ghcr.io/test/composery@sha256:abc");
	});

	// A comp mints real infrastructure, so it answers to the same capacity gate a
	// paid checkout does - including the one that holds everything back until a
	// deployment's provider limits have been entered at all.
	test("refuses a comp while the deployment has no capacity limits configured", async () => {
		const t = testConvex();
		const { admin, customer } = await cast(t);

		await expect(
			admin.as.mutation(api.staff.boxes.grantComp, {
				plan: "air",
				email: customer.email,
				slug: "gift",
				reason: "conference"
			})
		).rejects.toThrow(/capacity/i);
	});

	test("refuses a comp once the server limit is reached", async () => {
		const t = testConvex();
		const { admin, customer } = await cast(t);
		await seedSettings(t, { hetzner_server_limit: 1 });
		await seedBox(t, { user_id: "someone", slug: "existing" });

		await expect(
			admin.as.mutation(api.staff.boxes.grantComp, {
				plan: "air",
				email: customer.email,
				slug: "gift",
				reason: "conference"
			})
		).rejects.toThrow(/capacity/i);
	});

	test("creates a comped box for the named account", async () => {
		const t = testConvex();
		const { admin, customer } = await cast(t);
		await seedSettings(t);

		const { boxId } = await admin.as.mutation(api.staff.boxes.grantComp, {
			plan: "air",
			email: customer.email,
			slug: "gift",
			reason: "conference"
		});

		expect(await readBox(t, boxId)).toMatchObject({
			user_id: customer.clerkUserId,
			slug: "gift",
			status: "creating",
			comped_by: admin.clerkUserId,
			comp_reason: "conference"
		});
	});

	// A comp is backed by no subscription, so nothing else may look like one.
	test("leaves a comped box with no subscription attached", async () => {
		const t = testConvex();
		const { admin, customer } = await cast(t);
		await seedSettings(t);

		const { boxId } = await admin.as.mutation(api.staff.boxes.grantComp, {
			plan: "air",
			email: customer.email,
			slug: "gift",
			reason: "conference"
		});

		const box = await readBox(t, boxId);
		expect(box?.polar_subscription_id).toBeUndefined();
		expect(box?.polar_customer_id).toBeUndefined();
	});

	test("refuses a comp with no stated reason", async () => {
		const t = testConvex();
		const { admin, customer } = await cast(t);
		await seedSettings(t);

		await expect(
			admin.as.mutation(api.staff.boxes.grantComp, {
				plan: "air",
				email: customer.email,
				slug: "gift",
				reason: "   "
			})
		).rejects.toThrow(/reason is required/);
	});

	test("refuses a comp for an account that does not exist", async () => {
		const t = testConvex();
		const { admin } = await cast(t);
		await seedSettings(t);

		await expect(
			admin.as.mutation(api.staff.boxes.grantComp, {
				plan: "air",
				email: "nobody@example.com",
				slug: "gift",
				reason: "conference"
			})
		).rejects.toThrow(/User not found/);
	});

	test("refuses a comp for a suspended account", async () => {
		const t = testConvex();
		const { admin } = await cast(t);
		await seedSettings(t);
		const banned = await seedUser(t, {
			clerkUserId: "banned",
			email: "banned@example.com",
			suspended: true
		});

		await expect(
			admin.as.mutation(api.staff.boxes.grantComp, {
				plan: "air",
				email: banned.email,
				slug: "gift",
				reason: "conference"
			})
		).rejects.toThrow(/suspended/i);
	});

	test("refuses a comp on a slug that is already taken", async () => {
		const t = testConvex();
		const { admin, customer } = await cast(t);
		await seedSettings(t);
		await seedBox(t, { user_id: "someone", slug: "gift" });

		await expect(
			admin.as.mutation(api.staff.boxes.grantComp, {
				plan: "air",
				email: customer.email,
				slug: "gift",
				reason: "conference"
			})
		).rejects.toThrow(/unavailable/i);
	});

	test("refuses a comp to a customer", async () => {
		const t = testConvex();
		const { customer } = await cast(t);

		await expect(
			customer.as.mutation(api.staff.boxes.grantComp, {
				plan: "air",
				email: customer.email,
				slug: "gift",
				reason: "conference"
			})
		).rejects.toThrow(/Staff access required/);
	});

	// A comp has no subscription to revoke, so this is its only teardown lever -
	// and it must refuse to fire on a paid box, whose deletion has to go through
	// billing.
	test("refuses to revoke a comp on a box that is not one", async () => {
		const t = testConvex();
		const { admin, customer } = await cast(t);
		const boxId = await seedBox(t, {
			user_id: customer.clerkUserId,
			polar_subscription_id: "sub_1"
		});

		await expect(
			admin.as.mutation(api.staff.boxes.revokeComp, { boxId })
		).rejects.toThrow(/not a comp/);
	});

	test("tears down a comped box when its comp is revoked", async () => {
		const t = testConvex();
		const { admin, customer } = await cast(t);
		const boxId = await seedBox(t, {
			user_id: customer.clerkUserId,
			comped_at: NOW - 1000,
			comped_by: admin.clerkUserId,
			status: "running"
		});

		await admin.as.mutation(api.staff.boxes.revokeComp, { boxId });

		expect(await readBox(t, boxId)).toMatchObject({ status: "deleting" });
	});
});
