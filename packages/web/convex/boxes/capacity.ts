import type { Doc } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import { boxStatusesExcept, type BoxStatus } from "../model/box/status";
import { type BoxPlan, BOX_PLANS, BOX_PLAN_ORDER } from "../model/box/plan";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { readGlobalSettings } from "../settings";
import { staffConsoleUrl } from "../env";
import { raiseAlert } from "../staff/alerts";

// Every status but "deleted" holds a Hetzner server, so every one of them counts
// against the allocation.
export const CAPACITY_BOX_STATUSES: readonly BoxStatus[] =
	boxStatusesExcept("deleted");

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

// The settings capacity is a function of, and only those. It named
// `snapshotPolicy` too, which nothing here ever read - and one caller believed
// that name enough to admit a policy change against a before/after comparison
// that could only ever return the same number. A policy is timing; how many
// snapshots a box commits is its plan's `snapshotCap`.
export type CapacityConfig = {
	checkoutEnabled: boolean;
	hetznerServerLimit: number | null;
	hetznerSnapshotLimit: number | null;
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

// The snapshot entitlement one box of this plan commits, whether or not it has
// used any of it.
//
// The plan's total, not the box's split: moving the slider between automatic and
// manual moves slots from one column to the other and never changes how many the
// box can hold, so the fleet's commitment is unaffected by it. That is the whole
// reason the plan sells a total rather than two separate caps.
export function snapshotSlotsForPlan(plan: BoxPlan) {
	return BOX_PLANS[plan].snapshotCap;
}

// What admitting one more box has to reserve, before anyone has said which plan
// they are buying. The pricing page asks whether checkout is open at all, so the
// answer cannot depend on a choice that has not been made yet - and the safe
// direction is the expensive plan: room for a Pro box is room for an Air box,
// while the reverse is not true.
export function largestSnapshotSlotsPerBox() {
	return Math.max(...BOX_PLAN_ORDER.map(snapshotSlotsForPlan));
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
	activeCheckoutPlans,
	liveBoxes,
	snapshotRows
}: {
	activeCheckoutPlans: readonly BoxPlan[];
	liveBoxes: readonly { id: string; plan: BoxPlan }[];
	snapshotRows: readonly {
		boxId: string;
		imageId?: number;
		status: Doc<"box_snapshots">["status"];
	}[];
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

	// Each live box reserves its own plan's entitlement, counting the slots it has
	// already filled towards it rather than on top of it. A box that has more
	// snapshots than its plan now entitles it to - because it was downgraded while
	// holding manual ones - reserves nothing further; those rows are already
	// counted above, so the arithmetic stays honest without a special case.
	for (const box of liveBoxes) {
		const slots = snapshotSlotsForPlan(box.plan);
		commitments += Math.max(0, slots - (activeSnapshotsByBox.get(box.id) ?? 0));
	}
	for (const plan of activeCheckoutPlans) {
		commitments += snapshotSlotsForPlan(plan);
	}
	return commitments;
}

export async function readCapacityUsage(
	ctx: { db: DatabaseReader },
	config: CapacityConfig
): Promise<CapacityUsage> {
	const liveBoxes: { id: string; plan: BoxPlan }[] = [];
	for (const status of CAPACITY_BOX_STATUSES) {
		const boxes = await ctx.db
			.query("boxes")
			.withIndex("status", (query) => query.eq("status", status))
			.collect();
		for (const box of boxes) liveBoxes.push({ id: box._id, plan: box.plan });
	}

	const activeCheckouts = await ctx.db
		.query("box_checkout_intents")
		.withIndex("status_created_at", (query) => query.eq("status", "active"))
		.collect();
	const activeCheckoutPlans = activeCheckouts
		.filter((intent) => !intent.box_id)
		.map((intent) => intent.plan);

	const slotsPerBox = largestSnapshotSlotsPerBox();
	const snapshots = await ctx.db.query("box_snapshots").collect();
	// Pending captures already promise a future provider image. Failed or
	// deleting rows count only while they still reference an image that exists
	// (or is being removed) at Hetzner.
	const snapshotCommitments = reservedSnapshotCommitments({
		activeCheckoutPlans,
		liveBoxes,
		snapshotRows: snapshots.map((snapshot) => ({
			boxId: snapshot.box_id,
			imageId: snapshot.hetzner_image_id,
			status: snapshot.status
		}))
	});

	return capacityAvailability({
		activeCheckoutCount: activeCheckoutPlans.length,
		checkoutEnabled: config.checkoutEnabled,
		hetznerServerLimit: config.hetznerServerLimit,
		hetznerSnapshotLimit: config.hetznerSnapshotLimit,
		liveBoxCount: liveBoxes.length,
		snapshotCommitments,
		snapshotSlotsPerBox: slotsPerBox
	});
}

type CapacityAlertTransition =
	| { type: "none" }
	| { type: "clear" }
	| { type: "blocked"; reason: CapacityLimitBlockReason }
	| { type: "recovered"; reason: CapacityLimitBlockReason };

export function capacityAlertTransition(
	previous: CapacityLimitBlockReason | null,
	usage: Pick<CapacityUsage, "blockReason" | "limitBlockReason">
): CapacityAlertTransition {
	if (usage.limitBlockReason === previous) return { type: "none" };
	if (usage.limitBlockReason) {
		return { type: "blocked", reason: usage.limitBlockReason };
	}
	// Unreachable, and kept because the type system cannot see that: getting here
	// means `limitBlockReason` is null *and* differs from `previous`, so `previous`
	// is not null. The two returns below need that, and there is no assertion-free
	// way to tell TypeScript. No test can distinguish either branch of it.
	// Stryker disable next-line ConditionalExpression,ObjectLiteral,StringLiteral: unreachable narrowing - the first comparison above already returned for every input that could reach it with a null `previous`.
	if (!previous) return { type: "none" };
	if (usage.blockReason === "limits_not_configured") return { type: "clear" };
	return { type: "recovered", reason: previous };
}

function capacityLabel(reason: CapacityLimitBlockReason) {
	return reason === "server_limit" ? "server" : "snapshot";
}

export async function reconcileCapacityAlert(ctx: MutationCtx) {
	const stored = await ctx.db.query("settings").first();
	const settings = await readGlobalSettings(ctx);
	const usage = await readCapacityUsage(ctx, settings);
	const transition = capacityAlertTransition(
		stored?.capacity_alert_reason ?? null,
		usage
	);
	if (transition.type === "none") return transition;

	// Also unreachable, for the same shape of reason: with no settings row there
	// are no limits, so `readCapacityUsage` reports `limits_not_configured` with
	// no limit block, and `capacityAlertTransition` has already returned "none"
	// above. It stays because `stored` is what the patches below write to.
	// Stryker disable next-line ConditionalExpression: no settings row means no limits, which the "none" return above has already handled.
	if (!stored) return transition;
	if (transition.type === "clear") {
		await ctx.db.patch(stored._id, {
			capacity_alert_reason: undefined,
			capacity_alert_started_at: undefined
		});
		return transition;
	}

	if (transition.type === "blocked") {
		const startedAt = Date.now();
		await ctx.db.patch(stored._id, {
			capacity_alert_reason: transition.reason,
			capacity_alert_started_at: startedAt
		});
		const label = capacityLabel(transition.reason);
		await raiseAlert(ctx, {
			key: `capacity-exhausted:${transition.reason}:${startedAt}`,
			severity: "critical",
			subject: `New box ${label} capacity is exhausted`,
			text: `The configured Hetzner ${label} allocation can no longer fit another complete box package. New checkout is blocked by capacity admission; existing boxes are unaffected.\n\nReview commitments and the provider allocation: ${staffConsoleUrl()}`
		});
		return transition;
	}

	const startedAt = stored.capacity_alert_started_at ?? Date.now();
	await ctx.db.patch(stored._id, {
		capacity_alert_reason: undefined,
		capacity_alert_started_at: undefined
	});
	await raiseAlert(ctx, {
		key: `capacity-recovered:${transition.reason}:${startedAt}`,
		severity: "resolved",
		subject: `New box ${capacityLabel(transition.reason)} capacity recovered`,
		text: `The previous ${capacityLabel(transition.reason)} capacity block has cleared. Checkout is ${usage.checkoutAvailable ? "available" : "still unavailable for another reason"}.\n\nReview the current state: ${staffConsoleUrl()}`
	});
	return transition;
}

export const reconcile = internalMutation({
	args: {},
	handler: async (ctx) => await reconcileCapacityAlert(ctx)
});
