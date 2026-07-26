import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
	internalAction,
	internalMutation,
	internalQuery
} from "../_generated/server";
import type { BoxStatus } from "../schema";
import { startBoxOperation } from "./boxOperations";
import { isOperationAllowed } from "./boxOperationRules";

// Automatic repair: the fleet heals a box that has stopped serving, without its
// owner having to notice and press Repair.
//
// The whole design problem here is that a Composery box is a root-capable
// machine its owner is *supposed* to break. "Not serving" is a normal state for
// someone mid-experiment, so an unconditional healer would fight the owner,
// destroy work in progress, and burn a Hetzner volume per cycle doing it. Every
// constant below exists to make automatic repair rare, late, and bounded, and to
// keep the owner's own hand on the box strictly ahead of ours.

// How many consecutive failed health probes before a box counts as down. The
// sweep runs every 10 minutes, so this is roughly half an hour of a box not
// answering - long enough that a restart, a slow boot, or a blip has passed.
export const SUSTAINED_FAILURES = 3;

// How long after any owner-initiated operation automatic repair stays out of the
// way. Someone who just pressed Stop, Reset, Update, or changed configuration is
// working on this box; healing it under them would undo what they are doing and
// look like the product fighting them.
export const OWNER_QUIET_WINDOW_MS = 2 * 60 * 60 * 1000;

// Ceiling on automatic repairs per box per window. A box that needs a third
// repair in a day is not having a bad night - either the owner is breaking it
// deliberately or something is wrong that repair does not fix. Both are cases
// for a person to look at, not for the fleet to keep rebuilding hosts: each
// repair creates and deletes a Hetzner Volume and takes the box down while it
// runs, so an unbounded healer is also an unbounded bill.
export const AUTO_REPAIR_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_AUTO_REPAIRS_PER_WINDOW = 2;

// Recorded on every operation this module starts, and the thing that makes an
// automatic repair distinguishable from one the owner asked for - in the event
// log, in support, and in the window count below. Without it a box's history
// cannot answer "who did this".
export const AUTO_REPAIR_TRIGGER = "system:auto_repair";

export type AutoRepairFacts = {
	consecutiveFailures: number;
	// Operations started by a person on this box, most recent first, as
	// timestamps. Automatic ones are excluded by the caller.
	lastOwnerOperationAt: number | null;
	// Timestamps of automatic repairs already started within the window.
	recentAutoRepairs: readonly number[];
	status: BoxStatus;
};

export type AutoRepairDecision =
	| { repair: true }
	| {
			repair: false;
			// Why not, for the staff console and for tests. Every refusal is a
			// deliberate gate, so each one is named rather than collapsed into a
			// single boolean.
			reason:
				| "healthy"
				| "not_sustained"
				| "status_not_repairable"
				| "owner_recently_acted"
				| "attempt_limit_reached";
	  };

// Pure so the whole gate matrix is testable without a database, a host, or a
// clock. Every caller decides from this and nothing else.
export function autoRepairDecision(
	facts: AutoRepairFacts,
	now: number
): AutoRepairDecision {
	if (facts.consecutiveFailures === 0) {
		return { repair: false, reason: "healthy" };
	}
	if (facts.consecutiveFailures < SUSTAINED_FAILURES) {
		return { repair: false, reason: "not_sustained" };
	}
	// Asks the same table `beginBoxOperation` enforces, so this can never decide
	// to start a repair the backend will refuse - and, more importantly, never
	// touches a box that is mid-operation or deliberately stopped.
	if (!isOperationAllowed(facts.status, "repair")) {
		return { repair: false, reason: "status_not_repairable" };
	}
	if (
		facts.lastOwnerOperationAt !== null &&
		now - facts.lastOwnerOperationAt < OWNER_QUIET_WINDOW_MS
	) {
		return { repair: false, reason: "owner_recently_acted" };
	}

	const withinWindow = facts.recentAutoRepairs.filter(
		(at) => now - at < AUTO_REPAIR_WINDOW_MS
	);
	if (withinWindow.length >= MAX_AUTO_REPAIRS_PER_WINDOW) {
		return { repair: false, reason: "attempt_limit_reached" };
	}

	return { repair: true };
}

// Record one probe result, returning the running consecutive-failure count. A
// success resets the count to zero rather than decrementing it: the gate is
// "down continuously for N checks", and a box that flaps between reachable and
// unreachable is a different problem that repair would not fix.
export const recordProbe = internalMutation({
	args: {
		boxId: v.id("boxes"),
		reachable: v.boolean()
	},
	returns: v.number(),
	handler: async (ctx, args): Promise<number> => {
		const existing = await ctx.db
			.query("box_health")
			.withIndex("box_id", (query) => query.eq("box_id", args.boxId))
			.first();

		const now = Date.now();
		const consecutiveFailures = args.reachable
			? 0
			: (existing?.consecutive_failures ?? 0) + 1;

		if (existing) {
			await ctx.db.patch(existing._id, {
				consecutive_failures: consecutiveFailures,
				last_ok_at: args.reachable ? now : existing.last_ok_at,
				updated_at: now
			});
		} else {
			await ctx.db.insert("box_health", {
				box_id: args.boxId,
				consecutive_failures: consecutiveFailures,
				last_ok_at: args.reachable ? now : undefined,
				updated_at: now
			});
		}

		return consecutiveFailures;
	}
});

// Everything `autoRepairDecision` needs, read in one query so the decision is
// made against a single consistent view rather than several interleaved reads.
export const autoRepairFacts = internalQuery({
	args: { boxId: v.id("boxes") },
	handler: async (ctx, args): Promise<AutoRepairFacts | null> => {
		const box = await ctx.db.get(args.boxId);
		if (!box) return null;

		const health = await ctx.db
			.query("box_health")
			.withIndex("box_id", (query) => query.eq("box_id", args.boxId))
			.first();

		const since = Date.now() - AUTO_REPAIR_WINDOW_MS;
		const operations = await ctx.db
			.query("box_operations")
			.withIndex("box_id", (query) => query.eq("box_id", args.boxId))
			.order("desc")
			.take(50);

		const automatic = (operation: Doc<"box_operations">) =>
			operation.metadata?.triggered_by === AUTO_REPAIR_TRIGGER;

		return {
			consecutiveFailures: health?.consecutive_failures ?? 0,
			lastOwnerOperationAt:
				operations.find((operation) => !automatic(operation))?.created_at ??
				null,
			recentAutoRepairs: operations
				.filter(
					(operation) =>
						automatic(operation) &&
						operation.type === "repair" &&
						operation.created_at >= since
				)
				.map((operation) => operation.created_at),
			status: box.status
		};
	}
});

// The sweep. Probes every box that should be serving, records the result, and
// repairs the ones that have been down long enough and pass every gate.
//
// Boxes are handled independently and a failure on one never aborts the rest:
// this runs unattended, and one unreachable box must not stop the fleet's health
// from being tracked at all.
export const sweepBoxHealth = internalAction({
	args: {},
	handler: async (ctx) => {
		const boxes: { boxId: Id<"boxes">; slug: string }[] = await ctx.runQuery(
			internal.boxes.autoRepair.runningBoxes,
			{}
		);

		for (const box of boxes) {
			try {
				const { reachable } = await ctx.runAction(
					internal.boxes.boxHealth.probeRuntime,
					{ boxId: box.boxId }
				);
				await ctx.runMutation(internal.boxes.autoRepair.recordProbe, {
					boxId: box.boxId,
					reachable
				});
				if (reachable) continue;

				const facts = await ctx.runQuery(
					internal.boxes.autoRepair.autoRepairFacts,
					{ boxId: box.boxId }
				);
				if (!facts) continue;
				if (!autoRepairDecision(facts, Date.now()).repair) continue;

				await startBoxOperation(ctx, box.boxId, "repair", {
					// Deliberately not keyed by time: while an automatic repair is still
					// in flight this key deduplicates the next sweep's attempt, and once
					// it settles a later sweep may try again - bounded by the window
					// count rather than by the key.
					idempotencyKey: `auto-repair:${box.boxId}`,
					metadata: {
						triggered_by: AUTO_REPAIR_TRIGGER,
						reason: `Unreachable for ${facts.consecutiveFailures} consecutive health checks.`
					}
				});
			} catch {
				// Busy, no longer eligible, or a probe that threw. All are normal and
				// all resolve themselves on the next sweep.
			}
		}
	}
});

export const runningBoxes = internalQuery({
	args: {},
	handler: async (ctx) => {
		const boxes = await ctx.db
			.query("boxes")
			.withIndex("status", (query) => query.eq("status", "running"))
			.collect();
		return boxes.map((box) => ({ boxId: box._id, slug: box.slug }));
	}
});
