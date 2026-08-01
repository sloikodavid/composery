import type { Id } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { readGlobalSettings } from "../settings";
import { startBoxOperation } from "./operations";
import { BOX_OPERATIONS } from "../model/box/operation";
import { floorDeadlinePassed, runtimeStanding } from "./runtimeRelease";

// Which boxes the floor sweep considers: exactly the statuses an update may
// begin from, read from the table that enforces it rather than restated here.
//
// That table is `["running", "update_failed"]`, and the second entry is the
// whole reason this is derived. The sweep used to query `running` alone and
// filter on the same table afterwards - a filter that could not fail, because
// every row it saw was already `running`. So a box whose forced update failed
// landed in `update_failed` and left the only set this sweep looks at, for ever:
// it stayed below the mandatory floor with nothing retrying it and no failure to
// read, which is precisely the outcome a deadline exists to prevent.
//
// The statuses left out are left out by that table, not by this one. A stopped
// or suspended box cannot be reached over SSH, and a box mid-operation must not
// have one queued behind it; both are picked up by a later run once they are
// eligible again.
export const FLOOR_UPDATE_STATUSES = BOX_OPERATIONS.update.from;

// Boxes whose floor deadline has passed and which are still below it.
export const boxesPastFloorDeadline = internalQuery({
	args: {},
	handler: async (ctx) => {
		const settings = await readGlobalSettings(ctx);
		// A cost guard, not a decision: `floorDeadlinePassed` already refuses every
		// box when no deadline is set, so removing this changes nothing but the
		// hourly table scan it saves on the deployments that have no floor - which
		// is most of them. Equivalent by construction, hence the annotation rather
		// than a test that could only assert the same empty list twice.
		// Stryker disable next-line ConditionalExpression: skipping the scan is the whole effect; the answer is identical either way.
		if (!settings.minimumRuntime?.deadline) return [];

		const now = Date.now();
		const boxIds: Id<"boxes">[] = [];
		for (const status of FLOOR_UPDATE_STATUSES) {
			const boxes = await ctx.db
				.query("boxes")
				.withIndex("status", (query) => query.eq("status", status))
				.collect();
			for (const box of boxes) {
				const standing = runtimeStanding({
					boxImage: box.runtime_image,
					boxVersion: box.runtime_version,
					fleet: settings.runtimeRelease,
					minimum: settings.minimumRuntime
				});
				if (floorDeadlinePassed(standing, now)) boxIds.push(box._id);
			}
		}
		return boxIds;
	}
});

// Update the boxes whose owners have run out of time to do it themselves.
//
// This is the only path that recreates a box's container without its owner
// asking, so it is deliberately narrow: it fires only when staff have set both
// a floor image and a deadline, only on boxes actually below that floor, and
// only once that deadline has passed. A floor with no deadline announces itself
// in the interface and never acts.
//
// Failures are per box and never abort the batch - one unreachable host must not
// stop the rest of the fleet from crossing the floor. Each failure is already
// recorded against its own operation and alerted on by `markOperationFailed`, so
// there is nothing to re-report here.
export const updateBoxesPastDeadline = internalAction({
	args: {},
	handler: async (ctx) => {
		const boxIds = await ctx.runQuery(
			internal.boxes.runtimeFloor.boxesPastFloorDeadline,
			{}
		);

		for (const boxId of boxIds) {
			try {
				await startBoxOperation(ctx, boxId, "update", {
					// Keyed by box alone, and deliberately not by the deadline: the key
					// only ever matches an operation that is still pending or running, so
					// it stops a second update being queued behind one in flight while
					// leaving a box whose update failed free to be retried next run.
					idempotencyKey: `floor-update:${boxId}`,
					metadata: { reason: "minimum_runtime_version" },
					trigger: "system:runtime_floor"
				});
			} catch {
				// Busy with another operation, or no longer eligible. Both are normal
				// and both resolve themselves by the next run.
			}
		}
	}
});
