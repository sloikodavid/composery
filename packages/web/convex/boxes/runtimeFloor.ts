import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { readGlobalSettings } from "../settings";
import { startBoxOperation } from "./operations";
import { isOperationAllowed } from "./operationRules";
import { floorDeadlinePassed, runtimeStanding } from "./runtimeRelease";

// Boxes whose floor deadline has passed and which are still below it.
//
// Only `running` boxes are returned. A stopped or suspended box cannot be
// updated over SSH at all, and a box mid-operation must not have one queued
// behind it - `startOperation` would refuse anyway, but asking it to refuse
// once per box per hour turns a normal state into a stream of failures. Those
// boxes are simply picked up by a later run, once they are running again.
export const boxesPastFloorDeadline = internalQuery({
	args: {},
	handler: async (ctx) => {
		const settings = await readGlobalSettings(ctx);
		if (!settings.minimumRuntime?.deadline) return [];

		const now = Date.now();
		const boxes = await ctx.db
			.query("boxes")
			.withIndex("status", (query) => query.eq("status", "running"))
			.collect();

		return boxes
			.filter((box) => {
				if (!isOperationAllowed(box.status, "update")) return false;
				const standing = runtimeStanding({
					boxImage: box.runtime_image,
					boxVersion: box.runtime_version,
					fleet: settings.runtimeRelease,
					minimum: settings.minimumRuntime
				});
				return floorDeadlinePassed(standing, now);
			})
			.map((box) => ({ boxId: box._id, slug: box.slug }));
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
		const targets = await ctx.runQuery(
			internal.boxes.runtimeFloor.boxesPastFloorDeadline,
			{}
		);

		for (const target of targets) {
			try {
				await startBoxOperation(ctx, target.boxId, "update", {
					// Keyed by box and floor deadline, so a box that fails to cross one
					// deadline is retried on the next run, but a box already being
					// updated for this deadline is not queued twice.
					idempotencyKey: `floor-update:${target.boxId}`,
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
