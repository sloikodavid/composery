import type { Doc } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import type { BoxStatus } from "../schema";
import type { SnapshotPolicy } from "./snapshotPolicy";

export const CAPACITY_BOX_STATUSES = [
	"provisioning",
	"running",
	"provisioning_failed",
	"stopping",
	"stopped",
	"starting",
	"resetting",
	"reset_failed",
	"repairing",
	"restoring",
	"restore_failed",
	"suspending",
	"suspended",
	"unsuspending",
	"deleting",
	"delete_failed"
] as const satisfies readonly BoxStatus[];

const SNAPSHOT_COMMITMENT_STATUSES = new Set<Doc<"box_snapshots">["status"]>([
	"pending",
	"creating",
	"complete"
]);

export type CapacityBlockReason =
	| "manual_pause"
	| "limits_not_configured"
	| "server_limit"
	| "snapshot_limit"
	| null;

export type CapacityLimitBlockReason = Extract<
	CapacityBlockReason,
	"server_limit" | "snapshot_limit"
>;

export type CapacityConfig = {
	checkoutEnabled: boolean;
	hetznerServerLimit: number | null;
	hetznerSnapshotLimit: number | null;
	snapshotPolicy: SnapshotPolicy;
};

export type CapacityUsage = {
	activeCheckoutCount: number;
	availableNewBoxes: number;
	blockReason: CapacityBlockReason;
	checkoutAvailable: boolean;
	limitBlockReason: CapacityLimitBlockReason | null;
	liveBoxCount: number;
	serverCommitments: number;
	snapshotCommitments: number;
	snapshotSlotsPerBox: number;
};

export function capacityBlockMessage(reason: CapacityBlockReason) {
	switch (reason) {
		case "manual_pause":
			return "New box checkout is temporarily paused.";
		case "limits_not_configured":
			return "New box checkout is temporarily unavailable while infrastructure capacity is configured.";
		case "server_limit":
			return "New box checkout is temporarily unavailable because server capacity is fully committed.";
		case "snapshot_limit":
			return "New box checkout is temporarily unavailable because snapshot capacity is fully committed.";
		default:
			return null;
	}
}

export function snapshotSlotsPerBox(policy: SnapshotPolicy) {
	return policy.manualCap + policy.automaticCap;
}

export function capacityAvailability({
	activeCheckoutCount,
	checkoutEnabled,
	hetznerServerLimit,
	hetznerSnapshotLimit,
	liveBoxCount,
	snapshotCommitments,
	snapshotSlotsPerBox: slotsPerBox
}: {
	activeCheckoutCount: number;
	checkoutEnabled: boolean;
	hetznerServerLimit: number | null;
	hetznerSnapshotLimit: number | null;
	liveBoxCount: number;
	snapshotCommitments: number;
	snapshotSlotsPerBox: number;
}): CapacityUsage {
	const serverCommitments = liveBoxCount + activeCheckoutCount;
	const configured =
		hetznerServerLimit !== null && hetznerSnapshotLimit !== null;
	const serverRemaining = configured
		? Math.max(0, hetznerServerLimit - serverCommitments)
		: 0;
	const snapshotRemaining = configured
		? Math.max(0, hetznerSnapshotLimit - snapshotCommitments)
		: 0;
	const availableNewBoxes = configured
		? Math.min(serverRemaining, Math.floor(snapshotRemaining / slotsPerBox))
		: 0;

	let limitBlockReason: CapacityLimitBlockReason | null = null;
	if (configured && serverRemaining < 1) limitBlockReason = "server_limit";
	else if (configured && snapshotRemaining < slotsPerBox)
		limitBlockReason = "snapshot_limit";

	let blockReason: CapacityBlockReason = null;
	if (!checkoutEnabled) blockReason = "manual_pause";
	else if (!configured) blockReason = "limits_not_configured";
	else blockReason = limitBlockReason;

	return {
		activeCheckoutCount,
		availableNewBoxes,
		blockReason,
		checkoutAvailable: blockReason === null,
		limitBlockReason,
		liveBoxCount,
		serverCommitments,
		snapshotCommitments,
		snapshotSlotsPerBox: slotsPerBox
	};
}

export function reservedSnapshotCommitments({
	activeCheckoutCount,
	liveBoxIds,
	snapshotRows,
	slotsPerBox
}: {
	activeCheckoutCount: number;
	liveBoxIds: ReadonlySet<string>;
	snapshotRows: readonly {
		boxId: string;
		imageId?: number;
		status: Doc<"box_snapshots">["status"];
	}[];
	slotsPerBox: number;
}) {
	const activeSnapshotsByBox = new Map<string, number>();
	let commitments = 0;
	for (const snapshot of snapshotRows) {
		const active = SNAPSHOT_COMMITMENT_STATUSES.has(snapshot.status);
		if (active) {
			activeSnapshotsByBox.set(
				snapshot.boxId,
				(activeSnapshotsByBox.get(snapshot.boxId) ?? 0) + 1
			);
		}
		if (active || snapshot.imageId !== undefined) commitments += 1;
	}

	for (const boxId of liveBoxIds) {
		const activeSnapshots = activeSnapshotsByBox.get(boxId) ?? 0;
		commitments += Math.max(0, slotsPerBox - activeSnapshots);
	}
	return commitments + activeCheckoutCount * slotsPerBox;
}

export async function readCapacityUsage(
	ctx: { db: DatabaseReader },
	config: CapacityConfig
): Promise<CapacityUsage> {
	const liveBoxIds = new Set<string>();
	for (const status of CAPACITY_BOX_STATUSES) {
		const boxes = await ctx.db
			.query("boxes")
			.withIndex("status", (query) => query.eq("status", status))
			.collect();
		for (const box of boxes) liveBoxIds.add(box._id);
	}

	const activeCheckouts = await ctx.db
		.query("box_checkout_intents")
		.withIndex("status_created_at", (query) => query.eq("status", "active"))
		.collect();
	const activeCheckoutCount = activeCheckouts.filter(
		(intent) => !intent.box_id
	).length;

	const slotsPerBox = snapshotSlotsPerBox(config.snapshotPolicy);
	const snapshots = await ctx.db.query("box_snapshots").collect();
	// Pending captures already promise a future provider image. Failed or
	// deleting rows count only while they still reference an image that exists
	// (or is being removed) at Hetzner.
	const snapshotCommitments = reservedSnapshotCommitments({
		activeCheckoutCount,
		liveBoxIds,
		slotsPerBox,
		snapshotRows: snapshots.map((snapshot) => ({
			boxId: snapshot.box_id,
			imageId: snapshot.hetzner_image_id,
			status: snapshot.status
		}))
	});

	return capacityAvailability({
		activeCheckoutCount,
		checkoutEnabled: config.checkoutEnabled,
		hetznerServerLimit: config.hetznerServerLimit,
		hetznerSnapshotLimit: config.hetznerSnapshotLimit,
		liveBoxCount: liveBoxIds.size,
		snapshotCommitments,
		snapshotSlotsPerBox: slotsPerBox
	});
}
