import { describe, expect, test } from "vitest";
import {
	CAPACITY_BOX_STATUSES,
	capacityAvailability,
	reservedSnapshotCommitments,
	snapshotSlotsPerBox
} from "@/convex/boxes/capacity";
import { vBoxStatus } from "@/convex/schema";

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

	test("reserves the full configured snapshot package per box and checkout", () => {
		expect(
			snapshotSlotsPerBox({
				automaticCap: 5,
				automaticRetentionDays: 5,
				manualCap: 5,
				manualMinIntervalMinutes: 5,
				manualRetentionDays: 30
			})
		).toBe(10);
		expect(
			reservedSnapshotCommitments({
				activeCheckoutCount: 1,
				liveBoxIds: new Set(["box-a", "box-b"]),
				slotsPerBox: 10,
				snapshotRows: [
					{ boxId: "box-a", imageId: 1, status: "complete" },
					{ boxId: "box-a", status: "pending" }
				]
			})
		).toBe(30);
	});

	test("counts over-cap and deleting provider images until they are gone", () => {
		expect(
			reservedSnapshotCommitments({
				activeCheckoutCount: 0,
				liveBoxIds: new Set(["box-a"]),
				slotsPerBox: 2,
				snapshotRows: [
					{ boxId: "box-a", imageId: 1, status: "complete" },
					{ boxId: "box-a", imageId: 2, status: "complete" },
					{ boxId: "box-a", imageId: 3, status: "complete" },
					{ boxId: "deleted-box", imageId: 4, status: "deleting" },
					{ boxId: "box-a", status: "failed" }
				]
			})
		).toBe(4);
	});
});
