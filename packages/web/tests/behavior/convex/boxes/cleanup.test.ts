import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "@/convex/_generated/api";
import {
	DELETE_ATTEMPTS_BEFORE_ALERT,
	deleteNeedsPerson
} from "@/convex/boxes/cleanup";
import { SUBSCRIPTION_RECONCILIATION_STATUSES } from "@/convex/boxes/queries";
import {
	boxOperations,
	scheduledArgs,
	scheduledJobs,
	seedBox,
	staffAlerts,
	testConvex
} from "../../../support/convex";

const NOW = Date.UTC(2026, 6, 29, 10, 0, 0);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("deleteNeedsPerson", () => {
	// The incident this sweep exists for had exactly one failed delete, on a box
	// whose Hetzner teardown had already finished. A rule that only reacted to
	// repeat failures would have stayed silent on it - which is what happened.
	test("does not call one failure a standing problem", () => {
		expect(deleteNeedsPerson(1)).toBe(false);
	});

	test("escalates at the threshold and not before", () => {
		expect(deleteNeedsPerson(DELETE_ATTEMPTS_BEFORE_ALERT - 1)).toBe(false);
		expect(deleteNeedsPerson(DELETE_ATTEMPTS_BEFORE_ALERT)).toBe(true);
		expect(deleteNeedsPerson(DELETE_ATTEMPTS_BEFORE_ALERT + 10)).toBe(true);
	});
});

describe("delete_failed has one owner", () => {
	// If subscription reconciliation started reaching delete_failed boxes again,
	// two hourly sweeps would re-drive the same deletion under different triggers
	// and the box's history would stop saying which one was finishing it.
	test("leaves delete_failed to the sweep that finishes deletions", () => {
		expect(SUBSCRIPTION_RECONCILIATION_STATUSES).not.toContain("delete_failed");
	});

	// The exclusion has to stay narrow: a box that is merely broken is not on its
	// way out, and its subscription still has to be checked.
	test("still reconciles boxes that failed something other than deletion", () => {
		expect(SUBSCRIPTION_RECONCILIATION_STATUSES).toContain("repair_failed");
		expect(SUBSCRIPTION_RECONCILIATION_STATUSES).toContain("create_failed");
		expect(SUBSCRIPTION_RECONCILIATION_STATUSES).toContain("running");
	});
});

describe("finishFailedDeletions", () => {
	test("alerts at the threshold without abandoning the deletion retry", async () => {
		const t = testConvex();
		const boxId = await seedBox(t, {
			user_id: "owner",
			status: "delete_failed"
		});
		await t.run(async (ctx) => {
			for (let attempt = 0; attempt < DELETE_ATTEMPTS_BEFORE_ALERT; attempt++) {
				await ctx.db.insert("box_operations", {
					box_id: boxId,
					type: "delete",
					status: "failed",
					idempotency_key: `failed:${attempt}`,
					trigger: "system:delete_retry",
					created_at: attempt,
					updated_at: attempt
				});
			}
		});

		await t.action(internal.boxes.cleanup.finishFailedDeletions, {});

		expect(await staffAlerts(t)).toEqual([
			expect.objectContaining({
				severity: "critical",
				subject: expect.stringContaining(
					`has failed to delete ${DELETE_ATTEMPTS_BEFORE_ALERT} times`
				)
			})
		]);
		expect(await boxOperations(t, boxId)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					idempotency_key: `delete:${boxId}`,
					status: "pending",
					trigger: "system:delete_retry",
					type: "delete"
				})
			])
		);
	});

	test("retries below the threshold without raising a staff alert", async () => {
		const t = testConvex();
		const boxId = await seedBox(t, {
			user_id: "owner",
			status: "delete_failed"
		});
		await t.run(
			async (ctx) =>
				await ctx.db.insert("box_operations", {
					box_id: boxId,
					type: "delete",
					status: "failed",
					idempotency_key: "failed:once",
					trigger: "system:delete_retry",
					created_at: 1,
					updated_at: 1
				})
		);

		await t.action(internal.boxes.cleanup.finishFailedDeletions, {});

		expect(await staffAlerts(t)).toEqual([]);
		expect(await boxOperations(t, boxId)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "pending",
					trigger: "system:delete_retry",
					type: "delete"
				})
			])
		);
	});
});

describe("purgeBox", () => {
	test("removes runtime health, unlinks billing evidence, and schedules provider cleanup", async () => {
		const t = testConvex();
		const boxId = await seedBox(t, {
			deleted_at: NOW - 2,
			purge_at: NOW - 1,
			status: "deleted",
			user_id: "deleted:owner"
		});
		const { healthId, intentId, snapshotId } = await t.run(async (ctx) => {
			const healthId = await ctx.db.insert("box_health", {
				box_id: boxId,
				consecutive_failures: 4,
				updated_at: NOW - 10
			});
			const intentId = await ctx.db.insert("box_checkout_intents", {
				box_id: boxId,
				created_at: NOW - 10,
				plan: "air",
				slug: "old-box",
				status: "converted",
				updated_at: NOW - 10,
				user_id: "deleted:owner"
			});
			const snapshotId = await ctx.db.insert("box_snapshots", {
				box_id: boxId,
				class: "manual",
				created_at: NOW - 10,
				status: "complete",
				user_id: "deleted:owner"
			});
			return { healthId, intentId, snapshotId };
		});

		await t.mutation(internal.boxes.cleanup.purgeBox, { boxId });

		const rows = await t.run(async (ctx) => ({
			box: await ctx.db.get(boxId),
			health: await ctx.db.get(healthId),
			intent: await ctx.db.get(intentId)
		}));
		expect(rows.health).toBeNull();
		expect(rows.intent?.slug).toBe(`deleted-${intentId}`);
		expect(Object.hasOwn(rows.intent ?? {}, "box_id")).toBe(false);
		expect(rows.box).not.toBeNull();
		expect(
			await scheduledArgs<{ snapshotRowId: typeof snapshotId }>(
				t,
				"boxes/snapshots:runDelete"
			)
		).toEqual([{ snapshotRowId: snapshotId }]);
	});

	test("reschedules each independent dependency and deletes only an empty box", async () => {
		for (const dependency of [
			"health",
			"intent",
			"snapshot",
			"none"
		] as const) {
			const t = testConvex();
			const boxId = await seedBox(t, {
				deleted_at: NOW - 2,
				purge_at: NOW - 1,
				slug: `box-${dependency}`,
				status: "deleted",
				user_id: "deleted:owner"
			});
			await t.run(async (ctx) => {
				if (dependency === "health") {
					await ctx.db.insert("box_health", {
						box_id: boxId,
						consecutive_failures: 1,
						updated_at: NOW - 10
					});
				}
				if (dependency === "intent") {
					await ctx.db.insert("box_checkout_intents", {
						box_id: boxId,
						created_at: NOW - 10,
						plan: "air",
						slug: "old-box",
						status: "converted",
						updated_at: NOW - 10,
						user_id: "deleted:owner"
					});
				}
				if (dependency === "snapshot") {
					await ctx.db.insert("box_snapshots", {
						box_id: boxId,
						class: "manual",
						created_at: NOW - 10,
						status: "complete",
						user_id: "deleted:owner"
					});
				}
			});

			await t.mutation(internal.boxes.cleanup.purgeBox, { boxId });

			const box = await t.run(async (ctx) => await ctx.db.get(boxId));
			const purgeJobs = (await scheduledJobs(t)).filter(
				(job) => job.name === "boxes/cleanup:purgeBox"
			);
			if (dependency === "none") {
				expect(box).toBeNull();
				expect(purgeJobs).toEqual([]);
			} else {
				expect(box).not.toBeNull();
				expect(purgeJobs).toEqual([
					expect.objectContaining({
						scheduledTime: NOW + (dependency === "snapshot" ? 60_000 : 0),
						args: [{ boxId }]
					})
				]);
			}
		}
	});
});
