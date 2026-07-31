import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
	DEFAULT_SNAPSHOT_POLICY,
	SNAPSHOT_INCOMPLETE_RETENTION_MS
} from "@/convex/boxes/snapshotPolicy";
import type { BoxPlan } from "@/convex/schema";
import { BOX_PLANS, resolveSnapshotSplit } from "@/lib/boxes/plan";

// The manual half of a Box Pro box's allowance, at the split a new one is
// created with. Read rather than written down, so changing the plan's default
// moves these tests with it instead of leaving them asserting a stale number.
const PRO_MANUAL_CAP = resolveSnapshotSplit(
	"pro",
	BOX_PLANS.pro.snapshotManualDefault
).manual;
const PRO_AUTOMATIC_CAP = resolveSnapshotSplit(
	"pro",
	BOX_PLANS.pro.snapshotManualDefault
).automatic;

import {
	boxOperations,
	readBox,
	readOperation,
	scheduledArgs,
	seedBox,
	seedUser,
	stubDeploymentEnv,
	testConvex,
	type Harness
} from "../../../support/convex.ts";

// Snapshots are the one thing on a box that both costs money while it exists and
// is the owner's only copy of their files, so both directions are dangerous: an
// uncapped snapshot bills forever, and an over-eager eviction destroys the copy
// someone was relying on. The rule the tests below defend is that manual
// snapshots are refused at the cap and never evicted, while automatic ones roll.
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const NOW = Date.UTC(2026, 6, 7, 8, 9, 10);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	stubDeploymentEnv();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

type SnapshotSeed = {
	class?: Doc<"box_snapshots">["class"];
	createdAt?: number;
	expiresAt?: number;
	imageId?: number;
	status?: Doc<"box_snapshots">["status"];
};

async function seedSnapshot(
	t: Harness,
	boxId: Id<"boxes">,
	userId: string,
	seed: SnapshotSeed = {}
) {
	return await t.run(
		async (ctx) =>
			await ctx.db.insert("box_snapshots", {
				box_id: boxId,
				user_id: userId,
				class: seed.class ?? "manual",
				status: seed.status ?? "complete",
				hetzner_image_id: seed.imageId,
				created_at: seed.createdAt ?? NOW - DAY_MS,
				expires_at: seed.expiresAt
			})
	);
}

function snapshotsOf(t: Harness, boxId: Id<"boxes">) {
	return t.run(
		async (ctx) =>
			await ctx.db
				.query("box_snapshots")
				.withIndex("box_id_created_at", (q) => q.eq("box_id", boxId))
				.collect()
	);
}

// Capture-on-demand is a plan capability, so every test about the manual path
// needs a plan that has it. The default seed is deliberately the plan without
// one, which is why this says so rather than relying on it.
async function ownedRunningBox(t: Harness, plan: BoxPlan = "pro") {
	const owner = await seedUser(t, { clerkUserId: "owner" });
	const boxId = await seedBox(t, {
		user_id: owner.clerkUserId,
		plan,
		manual_snapshot_cap: BOX_PLANS[plan].snapshotManualDefault,
		slug: "mine",
		status: "running"
	});
	return { boxId, owner };
}

describe("taking a manual snapshot", () => {
	// The gate that makes on-demand capture a Pro feature. It comes before every
	// other check - a plan that cannot take one is not "at its cap" or "in
	// cooldown", it simply does not have the feature.
	test("refuses a plan without capture-on-demand snapshots", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t, "air");

		await expect(
			owner.as.mutation(api.user.boxes.createSnapshot, { slug: "mine" })
		).rejects.toThrow(/Box Air takes automatic daily snapshots/);
		expect(await snapshotsOf(t, boxId)).toHaveLength(0);
		expect(await boxOperations(t, boxId)).toEqual([]);
	});

	// Staff are not an exception: a manual snapshot on a plan without them would
	// spend a provider slot that capacity admission never reserved for this box,
	// so the favour would really be a quiet over-subscription of the fleet.
	test("refuses staff the same capture on a plan without it", async () => {
		const t = testConvex();
		const { boxId } = await ownedRunningBox(t, "air");
		const staff = await seedUser(t, {
			clerkUserId: "staff",
			email: "staff@example.com",
			role: "admin"
		});

		await expect(
			staff.as.mutation(api.staff.boxes.createSnapshot, { boxId })
		).rejects.toThrow(/Box Air takes automatic daily snapshots/);
	});

	test("starts a snapshot operation for a running box", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);

		await owner.as.mutation(api.user.boxes.createSnapshot, { slug: "mine" });

		expect(await boxOperations(t, boxId)).toMatchObject([
			{ type: "snapshot", status: "pending", trigger: "owner" }
		]);
	});

	// The capture is taken off the running server, so there is nothing to capture
	// from a stopped one.
	test("refuses a snapshot of a box that is not running", async () => {
		const t = testConvex();
		const owner = await seedUser(t, { clerkUserId: "owner" });
		await seedBox(t, {
			user_id: owner.clerkUserId,
			plan: "pro",
			manual_snapshot_cap: BOX_PLANS.pro.snapshotManualDefault,
			slug: "mine",
			status: "stopped"
		});

		await expect(
			owner.as.mutation(api.user.boxes.createSnapshot, { slug: "mine" })
		).rejects.toThrow(/only available while the box is running/);
	});

	test("refuses a second snapshot while one is still being captured", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		await seedSnapshot(t, boxId, owner.clerkUserId, {
			status: "creating",
			createdAt: NOW - DAY_MS
		});

		await expect(
			owner.as.mutation(api.user.boxes.createSnapshot, { slug: "mine" })
		).rejects.toThrow(/already in progress/);
	});

	test("refuses a snapshot taken inside the manual cooldown", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		await seedSnapshot(t, boxId, owner.clerkUserId, {
			createdAt:
				NOW - DEFAULT_SNAPSHOT_POLICY.manualMinIntervalMinutes * MINUTE_MS + 1
		});

		await expect(
			owner.as.mutation(api.user.boxes.createSnapshot, { slug: "mine" })
		).rejects.toThrow(/moments ago/);
	});

	test("allows a snapshot once the cooldown has passed", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		await seedSnapshot(t, boxId, owner.clerkUserId, {
			createdAt:
				NOW - DEFAULT_SNAPSHOT_POLICY.manualMinIntervalMinutes * MINUTE_MS - 1
		});

		await owner.as.mutation(api.user.boxes.createSnapshot, { slug: "mine" });

		expect(await boxOperations(t, boxId)).toHaveLength(1);
	});

	// Manual snapshots are the owner's own checkpoints. At the cap the answer is
	// "delete one", never "we deleted your oldest one for you".
	test("refuses a manual snapshot at the cap rather than evicting one", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		for (let index = 0; index < PRO_MANUAL_CAP; index += 1) {
			await seedSnapshot(t, boxId, owner.clerkUserId, {
				createdAt: NOW - DAY_MS * (index + 2)
			});
		}

		await expect(
			owner.as.mutation(api.user.boxes.createSnapshot, { slug: "mine" })
		).rejects.toThrow(/snapshot limit/);
		expect(await snapshotsOf(t, boxId)).toHaveLength(PRO_MANUAL_CAP);
	});

	// A box full of automatic snapshots must not block the owner's own.
	test("counts only manual snapshots against the manual cap", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		for (let index = 0; index < PRO_MANUAL_CAP; index += 1) {
			await seedSnapshot(t, boxId, owner.clerkUserId, {
				class: "scheduled",
				createdAt: NOW - DAY_MS * (index + 2)
			});
		}

		await owner.as.mutation(api.user.boxes.createSnapshot, { slug: "mine" });

		expect(await boxOperations(t, boxId)).toHaveLength(1);
	});
});

// The owner moves slots between the two columns. It costs the fleet nothing -
// the total is what the plan sold - so the interesting cases are the ends of the
// range and what happens to snapshots already held on the side being shrunk.
describe("splitting a box's snapshot allowance", () => {
	test("moves slots between automatic and manual without changing the total", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		const cap = BOX_PLANS.pro.snapshotCap;

		await owner.as.mutation(api.user.boxes.setSnapshotSplit, {
			manualCap: cap,
			slug: "mine"
		});

		const box = await t.run(async (ctx) => await ctx.db.get(boxId));
		expect(resolveSnapshotSplit("pro", box!.manual_snapshot_cap)).toEqual({
			automatic: 0,
			manual: cap
		});
	});

	test("refuses more than the plan sells", async () => {
		const t = testConvex();
		const { owner } = await ownedRunningBox(t);

		await expect(
			owner.as.mutation(api.user.boxes.setSnapshotSplit, {
				manualCap: BOX_PLANS.pro.snapshotCap + 1,
				slug: "mine"
			})
		).rejects.toThrow(/includes/);
	});

	// A plan without manual snapshots has nothing to split, and saying so is
	// better than silently storing a number that resolves back to zero.
	test("refuses a split on a plan without manual snapshots", async () => {
		const t = testConvex();
		const { owner } = await ownedRunningBox(t, "air");

		await expect(
			owner.as.mutation(api.user.boxes.setSnapshotSplit, {
				manualCap: 1,
				slug: "mine"
			})
		).rejects.toThrow(/takes its snapshots automatically/);
	});

	// Lowering the manual side below what is already held must not delete
	// anything - those are the owner's own checkpoints. New ones are simply
	// refused until the existing ones expire or are removed, which is the rule a
	// full manual allowance has always followed.
	test("keeps snapshots already held when their side is shrunk", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		for (let index = 0; index < PRO_MANUAL_CAP; index += 1) {
			await seedSnapshot(t, boxId, owner.clerkUserId, {
				createdAt: NOW - DAY_MS * (index + 2)
			});
		}

		await owner.as.mutation(api.user.boxes.setSnapshotSplit, {
			manualCap: 0,
			slug: "mine"
		});

		expect(await snapshotsOf(t, boxId)).toHaveLength(PRO_MANUAL_CAP);
		await expect(
			owner.as.mutation(api.user.boxes.createSnapshot, { slug: "mine" })
		).rejects.toThrow(/snapshot limit/);
	});

	// Raising the manual side is what unblocks a box that was at its cap.
	test("lets a box at its manual cap take another once the split is raised", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		for (let index = 0; index < PRO_MANUAL_CAP; index += 1) {
			await seedSnapshot(t, boxId, owner.clerkUserId, {
				createdAt: NOW - DAY_MS * (index + 2)
			});
		}

		await owner.as.mutation(api.user.boxes.setSnapshotSplit, {
			manualCap: PRO_MANUAL_CAP + 1,
			slug: "mine"
		});
		await owner.as.mutation(api.user.boxes.createSnapshot, { slug: "mine" });

		expect(await boxOperations(t, boxId)).toHaveLength(1);
	});
});

describe("opening a snapshot row", () => {
	test("records the new snapshot as pending with a short incomplete expiry", async () => {
		const t = testConvex();
		const { boxId } = await ownedRunningBox(t);

		const { snapshotRowId } = await t.mutation(
			internal.boxes.snapshots.beginSnapshot,
			{ boxId, class: "manual" }
		);

		expect(
			await t.run(async (ctx) => await ctx.db.get(snapshotRowId))
		).toMatchObject({
			status: "pending",
			class: "manual",
			expires_at: NOW + SNAPSHOT_INCOMPLETE_RETENTION_MS
		});
	});

	// Automatic snapshots roll: the cap is a window, so the oldest finished one is
	// dropped to make room rather than the capture being refused.
	test("evicts the oldest automatic snapshot to make room for a new one", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		const oldest = await seedSnapshot(t, boxId, owner.clerkUserId, {
			class: "scheduled",
			createdAt: NOW - DAY_MS * 10
		});
		for (let index = 1; index < PRO_AUTOMATIC_CAP; index += 1) {
			await seedSnapshot(t, boxId, owner.clerkUserId, {
				class: "scheduled",
				createdAt: NOW - DAY_MS * (10 - index)
			});
		}

		await t.mutation(internal.boxes.snapshots.beginSnapshot, {
			boxId,
			class: "scheduled"
		});

		expect(
			await scheduledArgs<{ snapshotRowId: Id<"box_snapshots"> }>(
				t,
				"boxes/snapshots:runDelete"
			)
		).toEqual([{ snapshotRowId: oldest }]);
	});

	// Manual snapshots are never collateral for an automatic capture.
	test("never evicts a manual snapshot to make room for an automatic one", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		const manual = await seedSnapshot(t, boxId, owner.clerkUserId, {
			class: "manual",
			createdAt: NOW - DAY_MS * 100
		});
		for (let index = 0; index < PRO_AUTOMATIC_CAP; index += 1) {
			await seedSnapshot(t, boxId, owner.clerkUserId, {
				class: "scheduled",
				createdAt: NOW - DAY_MS * (10 - index)
			});
		}

		await t.mutation(internal.boxes.snapshots.beginSnapshot, {
			boxId,
			class: "scheduled"
		});

		const evicted = await scheduledArgs<{
			snapshotRowId: Id<"box_snapshots">;
		}>(t, "boxes/snapshots:runDelete");
		expect(evicted.map((job) => job.snapshotRowId)).not.toContain(manual);
	});
});

describe("finishing a capture", () => {
	async function openOperation(t: Harness, boxId: Id<"boxes">) {
		return await t.run(
			async (ctx) =>
				await ctx.db.insert("box_operations", {
					box_id: boxId,
					type: "snapshot",
					status: "running",
					idempotency_key: `snapshot:${boxId}`,
					trigger: "owner",
					created_at: NOW,
					updated_at: NOW
				})
		);
	}

	test("dates the finished snapshot from the policy's retention window", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		const snapshotRowId = await seedSnapshot(t, boxId, owner.clerkUserId, {
			status: "creating",
			createdAt: NOW
		});
		const operationId = await openOperation(t, boxId);

		await t.mutation(internal.boxes.snapshots.completeSnapshot, {
			snapshotRowId,
			operationId,
			sizeBytes: 1234
		});

		expect(
			await t.run(async (ctx) => await ctx.db.get(snapshotRowId))
		).toMatchObject({
			status: "complete",
			size_bytes: 1234,
			expires_at: NOW + DEFAULT_SNAPSHOT_POLICY.manualRetentionDays * DAY_MS
		});
	});

	// The capture really did succeed, so the operation closes whatever happened to
	// the row meanwhile - an operation left open blocks every later action on the
	// box, which is a far worse outcome than a snapshot nobody wanted.
	test("closes the operation even when the snapshot was deleted mid-capture", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		const snapshotRowId = await seedSnapshot(t, boxId, owner.clerkUserId, {
			status: "deleting"
		});
		const operationId = await openOperation(t, boxId);

		await t.mutation(internal.boxes.snapshots.completeSnapshot, {
			snapshotRowId,
			operationId
		});

		expect(await readOperation(t, operationId)).toMatchObject({
			status: "succeeded"
		});
		expect(
			await t.run(async (ctx) => await ctx.db.get(snapshotRowId))
		).toMatchObject({ status: "deleting" });
	});

	// The same rule from the other side: a failed capture must not resurrect a row
	// that has already been claimed for deletion.
	test("leaves a snapshot already claimed for deletion alone when the capture fails", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		const snapshotRowId = await seedSnapshot(t, boxId, owner.clerkUserId, {
			status: "deleting"
		});

		await t.mutation(internal.boxes.snapshots.failSnapshot, {
			snapshotRowId,
			error: "hetzner refused"
		});

		expect(
			await t.run(async (ctx) => await ctx.db.get(snapshotRowId))
		).toMatchObject({ status: "deleting" });
	});

	test("records why a capture failed", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		const snapshotRowId = await seedSnapshot(t, boxId, owner.clerkUserId, {
			status: "creating"
		});

		await t.mutation(internal.boxes.snapshots.failSnapshot, {
			snapshotRowId,
			error: "hetzner refused"
		});

		expect(
			await t.run(async (ctx) => await ctx.db.get(snapshotRowId))
		).toMatchObject({
			status: "failed",
			error: "hetzner refused",
			expires_at: NOW + SNAPSHOT_INCOMPLETE_RETENTION_MS
		});
	});
});

describe("expiring snapshots", () => {
	test("claims only snapshots whose expiry has passed", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		const expired = await seedSnapshot(t, boxId, owner.clerkUserId, {
			expiresAt: NOW - 1
		});
		const live = await seedSnapshot(t, boxId, owner.clerkUserId, {
			expiresAt: NOW + 1
		});

		const claim = await t.mutation(
			internal.boxes.snapshots.claimExpiredSnapshots,
			{ limit: 10 }
		);

		expect(claim.snapshotRowIds).toEqual([expired]);
		expect(await t.run(async (ctx) => await ctx.db.get(live))).toMatchObject({
			status: "complete"
		});
	});

	// Claiming is what stops two sweeps deleting the same image twice.
	test("marks what it claimed as deleting so a second sweep skips it", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		await seedSnapshot(t, boxId, owner.clerkUserId, { expiresAt: NOW - 1 });

		const first = await t.mutation(
			internal.boxes.snapshots.claimExpiredSnapshots,
			{ limit: 10 }
		);
		const second = await t.mutation(
			internal.boxes.snapshots.claimExpiredSnapshots,
			{ limit: 10 }
		);

		expect(first.snapshotRowIds).toHaveLength(1);
		expect(second.snapshotRowIds).toEqual([]);
	});

	test("says there is more to do when it fills its batch", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		await seedSnapshot(t, boxId, owner.clerkUserId, { expiresAt: NOW - 1 });
		await seedSnapshot(t, boxId, owner.clerkUserId, { expiresAt: NOW - 2 });

		const claim = await t.mutation(
			internal.boxes.snapshots.claimExpiredSnapshots,
			{ limit: 1 }
		);

		expect(claim).toMatchObject({ hasMore: true });
		expect(claim.snapshotRowIds).toHaveLength(1);
	});

	// A snapshot with no expiry is one nothing has finished deciding about yet;
	// sweeping it would delete a capture in flight.
	test("leaves a snapshot with no expiry alone", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		await seedSnapshot(t, boxId, owner.clerkUserId, { status: "creating" });

		const claim = await t.mutation(
			internal.boxes.snapshots.claimExpiredSnapshots,
			{ limit: 10 }
		);

		expect(claim.snapshotRowIds).toEqual([]);
	});
});

describe("automatic snapshots", () => {
	test("takes an automatic snapshot of a running box", async () => {
		const t = testConvex();
		const { boxId } = await ownedRunningBox(t);

		await t.mutation(internal.boxes.snapshots.startAutomaticSnapshot, {
			boxId
		});

		expect(await boxOperations(t, boxId)).toMatchObject([
			{ type: "snapshot", trigger: "system:auto_snapshot" }
		]);
	});

	// An owner who gives every slot to their own snapshots has asked for no daily
	// one. Starting an operation that then fails its capacity check would record a
	// failure every night for a box behaving exactly as configured.
	test("skips a box whose owner kept no slots for automatic snapshots", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		await owner.as.mutation(api.user.boxes.setSnapshotSplit, {
			manualCap: BOX_PLANS.pro.snapshotCap,
			slug: "mine"
		});

		await t.mutation(internal.boxes.snapshots.startAutomaticSnapshot, {
			boxId
		});

		expect(await boxOperations(t, boxId)).toEqual([]);
	});

	test("skips a box that is not running", async () => {
		const t = testConvex();
		const owner = await seedUser(t, { clerkUserId: "owner" });
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			status: "stopped"
		});

		await t.mutation(internal.boxes.snapshots.startAutomaticSnapshot, {
			boxId
		});

		expect(await boxOperations(t, boxId)).toEqual([]);
	});

	// A fleet-wide sweep must not fail because one box happens to be busy. The
	// box keeps whatever it was doing and the next sweep picks it up.
	test("gives way to whatever the box is already doing", async () => {
		const t = testConvex();
		const { boxId } = await ownedRunningBox(t);
		await t.mutation(internal.boxes.operations.startOperation, {
			boxId,
			idempotencyKey: `stop:${boxId}`,
			trigger: "owner",
			type: "stop"
		});

		await expect(
			t.mutation(internal.boxes.snapshots.startAutomaticSnapshot, { boxId })
		).resolves.toBeNull();
		expect(await readBox(t, boxId)).toMatchObject({ status: "stopping" });
	});
});

describe("deleting a box's snapshots", () => {
	test("queues every snapshot of a box for deletion", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		const first = await seedSnapshot(t, boxId, owner.clerkUserId, {
			imageId: 1
		});
		const second = await seedSnapshot(t, boxId, owner.clerkUserId, {
			imageId: 2
		});

		await t.mutation(internal.boxes.snapshots.cascadeDeleteBoxSnapshots, {
			boxId
		});

		const queued = await scheduledArgs<{
			snapshotRowId: Id<"box_snapshots">;
		}>(t, "boxes/snapshots:runDelete");
		expect(queued.map((job) => job.snapshotRowId).sort()).toEqual(
			[first, second].sort()
		);
	});

	test("leaves another box's snapshots out of the cascade", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		const otherBoxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			slug: "other"
		});
		await seedSnapshot(t, boxId, owner.clerkUserId);
		const untouched = await seedSnapshot(t, otherBoxId, owner.clerkUserId);

		await t.mutation(internal.boxes.snapshots.cascadeDeleteBoxSnapshots, {
			boxId
		});

		const queued = await scheduledArgs<{
			snapshotRowId: Id<"box_snapshots">;
		}>(t, "boxes/snapshots:runDelete");
		expect(queued.map((job) => job.snapshotRowId)).not.toContain(untouched);
		expect(await snapshotsOf(t, otherBoxId)).toHaveLength(1);
	});

	// Claiming twice must not run the Hetzner delete twice.
	test("claims a snapshot for deletion only once", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		const snapshotRowId = await seedSnapshot(t, boxId, owner.clerkUserId, {
			status: "deleting",
			imageId: 7
		});

		const claim = await t.mutation(
			internal.boxes.snapshots.claimSnapshotDelete,
			{ snapshotRowId }
		);

		expect(claim).toEqual({ imageId: 7 });
		expect(
			await t.run(async (ctx) => await ctx.db.get(snapshotRowId))
		).toMatchObject({ status: "deleting" });
	});

	test("reports nothing to delete for a snapshot row that is already gone", async () => {
		const t = testConvex();
		const { boxId, owner } = await ownedRunningBox(t);
		const snapshotRowId = await seedSnapshot(t, boxId, owner.clerkUserId);
		await t.run(async (ctx) => await ctx.db.delete(snapshotRowId));

		expect(
			await t.mutation(internal.boxes.snapshots.claimSnapshotDelete, {
				snapshotRowId
			})
		).toBeNull();
	});
});
