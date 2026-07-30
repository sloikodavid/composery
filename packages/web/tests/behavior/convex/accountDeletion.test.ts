import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";

import {
	boxOperations,
	scheduledJobs,
	seedBox,
	seedUser,
	stubDeploymentEnv,
	testConvex,
	type Harness
} from "../../support/convex.ts";

// Deleting an account is the one operation here that destroys a customer's work
// on purpose, and the whole of it runs unattended behind a webhook - nobody
// watches it, and there is no undo to reach for if a step is skipped. So what is
// asserted is the state each step leaves behind, not that it ran.

const NOW = Date.UTC(2026, 6, 29, 10, 0, 0);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	stubDeploymentEnv();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

function users(t: Harness) {
	return t.run(async (ctx) => await ctx.db.query("users").collect());
}

function intents(t: Harness) {
	return t.run(
		async (ctx) => await ctx.db.query("box_checkout_intents").collect()
	);
}

async function seedIntent(
	t: Harness,
	seed: Partial<Doc<"box_checkout_intents">> & { user_id: string }
) {
	return await t.run(
		async (ctx) =>
			await ctx.db.insert("box_checkout_intents", {
				slug: "reserved",
				plan: "air",
				status: "active",
				created_at: 1,
				updated_at: 1,
				...seed
			})
	);
}

describe("marking an account for deletion", () => {
	test("frees the slug a half-finished checkout was still holding", async () => {
		const t = testConvex();
		const user = await seedUser(t);
		await seedIntent(t, { user_id: user.clerkUserId });

		await t.mutation(internal.accountDeletion.markAccountDeletionPending, {
			clerkUserId: user.clerkUserId
		});

		expect(await intents(t)).toEqual([
			expect.objectContaining({
				status: "released",
				release_reason: "account_deleted"
			})
		]);
		expect((await users(t))[0]).toMatchObject({ deletion_pending: true });
	});

	// A reservation that already became a box is that box's billing record. The
	// box is torn down by its own delete operation; releasing the record it was
	// sold under would throw away the evidence behind a possible refund.
	test("leaves a converted reservation alone", async () => {
		const t = testConvex();
		const user = await seedUser(t);
		const boxId = await seedBox(t, { user_id: user.clerkUserId });
		await seedIntent(t, {
			user_id: user.clerkUserId,
			status: "converted",
			box_id: boxId
		});

		await t.mutation(internal.accountDeletion.markAccountDeletionPending, {
			clerkUserId: user.clerkUserId
		});

		expect((await intents(t))[0]).toMatchObject({ status: "converted" });
	});

	test("says nothing happened for an identity with no row", async () => {
		const t = testConvex();

		expect(
			await t.mutation(internal.accountDeletion.markAccountDeletionPending, {
				clerkUserId: "never-signed-in"
			})
		).toBeNull();
	});
});

describe("the webhook's own action", () => {
	// A comp box: the paid path revokes a Polar subscription first, which is a
	// network call, and what this asserts is the teardown it orders locally.
	test("marks the account and orders every box torn down", async () => {
		const t = testConvex();
		const user = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: user.clerkUserId,
			comped_at: 1,
			comped_by: "staff"
		});

		await t.action(
			internal.accountDeletion.requestAccountDeletionForClerkUser,
			{ clerkUserId: user.clerkUserId }
		);

		expect((await users(t))[0]).toMatchObject({ deletion_pending: true });
		expect(await boxOperations(t, boxId)).toEqual([
			expect.objectContaining({
				type: "delete",
				trigger: "system:account_deletion"
			})
		]);
		expect(
			await scheduledJobs(t, "accountDeletion:finalizeAccountDeletion")
		).toHaveLength(1);
	});

	// Clerk sends `user.deleted` for every identity it removes, including ones
	// that never reached Convex. Nothing to delete is not an error.
	test("does nothing for an identity that has no account here", async () => {
		const t = testConvex();

		await t.action(
			internal.accountDeletion.requestAccountDeletionForClerkUser,
			{ clerkUserId: "never-signed-in" }
		);

		expect(await users(t)).toEqual([]);
	});
});

describe("finishing a deletion", () => {
	test("waits while a box is still standing", async () => {
		const t = testConvex();
		const user = await seedUser(t, { deletionPending: true });
		await seedBox(t, { user_id: user.clerkUserId, status: "stopped" });

		await t.action(internal.accountDeletion.finalizeAccountDeletion, {
			clerkUserId: user.clerkUserId
		});

		expect((await users(t))[0].deletion_finished_at).toBeUndefined();
		expect(
			await scheduledJobs(t, "accountDeletion:finalizeAccountDeletion")
		).toHaveLength(1);
	});

	test("finishes once every box is gone", async () => {
		const t = testConvex();
		const user = await seedUser(t, {
			deletionPending: true,
			email: "person@example.com"
		});
		await seedBox(t, { user_id: user.clerkUserId, status: "deleted" });

		await t.action(internal.accountDeletion.finalizeAccountDeletion, {
			clerkUserId: user.clerkUserId
		});

		const [row] = await users(t);
		expect(row.deletion_finished_at).toEqual(expect.any(Number));
		expect(row.deletion_pending).toBe(false);
		expect(row.purge_at).toEqual(expect.any(Number));
		// The address is what identifies a person, so it goes. `@deleted.invalid`
		// can never be delivered to, which is what stops a later mailing from
		// reaching whoever inherits a recycled domain.
		expect(row.email).not.toContain("person@example.com");
		expect(row.email).toMatch(/@deleted\.invalid$/);
		// The Clerk id is rewritten too, so the row can no longer be reached by the
		// identity it belonged to - a re-signup with the same subject is a new
		// account rather than a resurrection of this one.
		expect(row.clerk_user_id).toMatch(/^deleted:/);
		expect(row.suspended).toBe(true);
	});

	test("refuses to scrub a row nobody asked to delete", async () => {
		const t = testConvex();
		const user = await seedUser(t, { email: "live@example.com" });

		await t.mutation(internal.accountDeletion.finishAccountDeletion, {
			clerkUserId: user.clerkUserId
		});

		const [row] = await users(t);
		expect(row.email).toBe("live@example.com");
		expect(row.deletion_finished_at).toBeUndefined();
	});

	// The box row outlives the account by its own retention window, so what is
	// left behind must no longer name the person it belonged to.
	test("pseudonymizes the records that outlive the account", async () => {
		const t = testConvex();
		const user = await seedUser(t);
		const boxId = await seedBox(t, { user_id: user.clerkUserId });
		await t.run(
			async (ctx) =>
				await ctx.db.insert("box_events", {
					box_id: boxId,
					user_id: user.clerkUserId,
					type: "box.create_started",
					created_at: 1
				})
		);

		await t.mutation(
			internal.accountDeletion.pseudonymizeDeletedAccountRecords,
			{ clerkUserId: user.clerkUserId, deletedUserId: "deleted:x" }
		);

		const [box, events] = await t.run(async (ctx) => [
			await ctx.db.get(boxId),
			await ctx.db.query("box_events").collect()
		]);
		expect(box?.user_id).toBe("deleted:x");
		expect(events.map((event) => event.user_id)).toEqual(["deleted:x"]);
	});
});

describe("purging a finished deletion", () => {
	async function seedFinished(t: Harness, purgeAt: number) {
		return await t.run(
			async (ctx) =>
				await ctx.db.insert("users", {
					clerk_user_id: "deleted:1",
					email: "deleted-1@deleted.invalid",
					role: "user",
					suspended: true,
					deletion_pending: false,
					deletion_finished_at: 1,
					purge_at: purgeAt,
					created_at: 1,
					updated_at: 1
				})
		);
	}

	test("removes the tombstone once nothing points at it", async () => {
		const t = testConvex();
		await seedFinished(t, NOW - 1);

		await t.mutation(internal.accountDeletion.purgeExpiredDeletedAccounts, {});

		expect(await users(t)).toEqual([]);
	});

	// Billing evidence outlives the account, and the tombstone is what those rows
	// still resolve against. Purging it early would orphan them.
	test("waits while a retained record still refers to it", async () => {
		const t = testConvex();
		const userId = await seedFinished(t, NOW - 1);
		await seedBox(t, { user_id: "deleted:1", status: "deleted" });

		await t.mutation(internal.accountDeletion.purgeExpiredDeletedAccounts, {});

		const row = await t.run(async (ctx) => await ctx.db.get(userId));
		expect(row?.purge_at).toBeGreaterThan(NOW);
	});

	// A live account carrying a purge date is stray state, and the sweep's index
	// range will keep selecting it. Clearing it is what stops a hand-edited or
	// half-migrated row from being deleted by a job that only ever meant to
	// collect tombstones.
	test("clears a purge date that landed on a live account", async () => {
		const t = testConvex();
		const user = await seedUser(t);
		await t.run(
			async (ctx) =>
				await ctx.db.patch(user.userId as Id<"users">, {
					purge_at: NOW - 1
				})
		);

		await t.mutation(internal.accountDeletion.purgeExpiredDeletedAccounts, {});

		const [row] = await users(t);
		expect(row.purge_at).toBeUndefined();
		expect(row.clerk_user_id).toBe(user.clerkUserId);
	});
});
