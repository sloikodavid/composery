import { describe, expect, test } from "vitest";
import {
	CAPACITY_BOX_STATUSES,
	capacityAvailability,
	largestSnapshotSlotsPerBox,
	reservedSnapshotCommitments,
	snapshotSlotsForPlan
} from "@/convex/boxes/capacity";
import { vBoxStatus } from "@/convex/schema";
import { BOX_PLANS } from "@/lib/box-plan";

describe("box capacity", () => {
	// These lists are hand-written subsets of the status union, so the type
	// checker cannot notice a missing one - a new status would silently stop
	// occupying capacity and the fleet would be over-committed by exactly the
	// boxes in it. Pin the rule instead: every status that is not "deleted"
	// holds a server.
	test("counts every live status against capacity", () => {
		const live = vBoxStatus.members
			.map((member) => member.value)
			.filter((status) => status !== "deleted");

		expect([...CAPACITY_BOX_STATUSES].sort()).toEqual(live.sort());
	});

	test("fails closed until both Hetzner allocations are configured", () => {
		expect(
			capacityAvailability({
				activeCheckoutCount: 0,
				checkoutEnabled: true,
				hetznerServerLimit: null,
				hetznerSnapshotLimit: null,
				liveBoxCount: 0,
				snapshotCommitments: 0,
				snapshotSlotsPerBox: 10
			})
		).toMatchObject({
			availableNewBoxes: 0,
			blockReason: "limits_not_configured",
			checkoutAvailable: false
		});
	});

	test("keeps a manual pause separate from calculated capacity", () => {
		expect(
			capacityAvailability({
				activeCheckoutCount: 1,
				checkoutEnabled: false,
				hetznerServerLimit: 10,
				hetznerSnapshotLimit: 100,
				liveBoxCount: 2,
				snapshotCommitments: 30,
				snapshotSlotsPerBox: 10
			})
		).toMatchObject({
			availableNewBoxes: 7,
			blockReason: "manual_pause",
			checkoutAvailable: false,
			serverCommitments: 3
		});
	});

	test("still exposes an exhausted allocation while checkout is manually paused", () => {
		expect(
			capacityAvailability({
				activeCheckoutCount: 1,
				checkoutEnabled: false,
				hetznerServerLimit: 3,
				hetznerSnapshotLimit: 100,
				liveBoxCount: 2,
				snapshotCommitments: 30,
				snapshotSlotsPerBox: 10
			})
		).toMatchObject({
			blockReason: "manual_pause",
			limitBlockReason: "server_limit"
		});
	});

	test("admits only the smaller of remaining server and snapshot capacity", () => {
		expect(
			capacityAvailability({
				activeCheckoutCount: 2,
				checkoutEnabled: true,
				hetznerServerLimit: 10,
				hetznerSnapshotLimit: 65,
				liveBoxCount: 3,
				snapshotCommitments: 50,
				snapshotSlotsPerBox: 10
			})
		).toMatchObject({
			availableNewBoxes: 1,
			blockReason: null,
			checkoutAvailable: true
		});
	});

	test("blocks when either complete package no longer fits", () => {
		const common = {
			activeCheckoutCount: 1,
			checkoutEnabled: true,
			liveBoxCount: 4,
			snapshotSlotsPerBox: 10
		};
		expect(
			capacityAvailability({
				...common,
				hetznerServerLimit: 5,
				hetznerSnapshotLimit: 100,
				snapshotCommitments: 50
			}).blockReason
		).toBe("server_limit");
		expect(
			capacityAvailability({
				...common,
				hetznerServerLimit: 10,
				hetznerSnapshotLimit: 59,
				snapshotCommitments: 50
			}).blockReason
		).toBe("snapshot_limit");
	});

	// A box commits the snapshot allowance its plan sells, and only that. How the
	// owner splits it between automatic and manual moves slots between columns and
	// never changes the total, so the fleet's commitment cannot be moved by a
	// slider - which is exactly why a plan sells a total rather than two caps.
	test("reserves the allowance a plan sells, whatever the split", () => {
		expect(snapshotSlotsForPlan("air")).toBe(BOX_PLANS.air.snapshotCap);
		expect(snapshotSlotsForPlan("pro")).toBe(BOX_PLANS.pro.snapshotCap);
		// Admission happens before a plan is chosen, so it assumes the largest.
		expect(largestSnapshotSlotsPerBox()).toBe(
			Math.max(BOX_PLANS.air.snapshotCap, BOX_PLANS.pro.snapshotCap)
		);
	});

	test("reserves each box and checkout against its own plan", () => {
		expect(
			reservedSnapshotCommitments({
				activeCheckoutPlans: ["pro"],
				liveBoxes: [
					{ id: "box-a", plan: "pro" },
					{ id: "box-b", plan: "air" }
				],
				snapshotRows: [
					{ boxId: "box-a", imageId: 1, status: "complete" },
					{ boxId: "box-a", status: "pending" }
				]
			})
			// box-a holds 2 of its Pro allowance and reserves the rest; box-b reserves
			// its whole Air allowance; the active checkout reserves a full Pro one.
		).toBe(
			BOX_PLANS.pro.snapshotCap +
				BOX_PLANS.air.snapshotCap +
				BOX_PLANS.pro.snapshotCap
		);
	});

	test("counts over-cap and deleting provider images until they are gone", () => {
		expect(
			reservedSnapshotCommitments({
				activeCheckoutPlans: [],
				liveBoxes: [{ id: "box-a", plan: "air" }],
				snapshotRows: [
					{ boxId: "box-a", imageId: 1, status: "complete" },
					{ boxId: "box-a", imageId: 2, status: "complete" },
					{ boxId: "box-a", imageId: 3, status: "complete" },
					{ boxId: "deleted-box", imageId: 4, status: "deleting" },
					{ boxId: "box-a", status: "failed" }
				]
			})
			// box-a holds 3 active against an entitlement of 2, so it reserves nothing
			// further; the deleting image of a gone box still holds a provider slot.
		).toBe(4);
	});

	// A box downgraded while holding manual snapshots keeps them until retention
	// expires, so it can legitimately hold more than its plan now entitles it to.
	// The arithmetic must stay non-negative rather than crediting quota back.
	test("never credits quota back for a box holding more than its plan allows", () => {
		expect(
			reservedSnapshotCommitments({
				activeCheckoutPlans: [],
				liveBoxes: [{ id: "box-a", plan: "air" }],
				snapshotRows: Array.from({ length: 9 }, (_, index) => ({
					boxId: "box-a",
					imageId: index + 1,
					status: "complete" as const
				}))
			})
		).toBe(9);
	});
});
