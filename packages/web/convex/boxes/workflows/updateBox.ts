import { internal } from "../../_generated/api";
import { defineBoxWorkflow } from "./boxWorkflow";

// Update - moves a box to the runtime image the deployment's channel currently
// resolves to, keeping its files. It is the only data-preserving way a box
// changes version: Reset re-resolves the channel too but rebuilds the host and
// keeps nothing, and Repair deliberately re-pulls the image the box is already
// pinned to, because "get me working again" must not also change what is
// running.
//
// The whole operation is a container recreate. The host is untouched, the named
// volumes holding the box's files are untouched, and persistence is built for
// exactly this: the new image ships a new lower and the box's delta is laid back
// over it on boot (see docs/developing/web/maintenance.md).
//
// Ordering is the only subtle part, and it is what makes a failure recoverable:
//
//   1. resolve the channel to a digest - a moving tag must not be re-resolved
//      later in the operation, or the compose file and the row could name two
//      different images;
//   2. write that digest into the box's compose file and bring the stack up,
//      holding until the editor answers;
//   3. only then advance `box.runtime_image`.
//
// Between 2 and 3 the row still names the image that last served. So any throw
// leaves the box in `update_failed` with a row Repair can rebuild from, and
// Repair rewrites the old compose file and puts the box back. There is no
// separate rollback path because this ordering is the rollback path.
export const updateBox = defineBoxWorkflow({
	onFailure: {
		eventType: "box.update_failed",
		targetBoxStatus: "update_failed"
	},
	run: async (step, args) => {
		const box = await step.runQuery(
			internal.boxes.boxQueries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		const release = await step.runAction(
			internal.boxes.infra.runtimeImages.resolveConfiguredRuntimeRelease,
			{},
			{ retry: true }
		);

		// Already on the target digest. This is a race, not a mistake - the fleet
		// version can move between the page rendering an Update button and the
		// owner pressing it, and a floor deadline can fire on a box an owner just
		// updated by hand. Settling cleanly is the honest outcome; failing would
		// report a problem that does not exist, and recreating the container
		// anyway would drop the owner's terminals for no change at all.
		if (box.runtime_image === release.image) {
			await step.runMutation(
				internal.boxes.boxStatus.setBoxStatusWithOperationSucceeded,
				{
					boxId: args.boxId,
					operationId: args.operationId,
					status: "running",
					eventType: "box.update_not_needed"
				}
			);
			return;
		}

		await step.runAction(
			internal.boxes.infra.ssh.updateRuntime,
			{ boxId: args.boxId, runtimeImage: release.image },
			{ retry: true }
		);

		await step.runMutation(internal.boxes.boxStatus.markUpdateSucceeded, {
			boxId: args.boxId,
			operationId: args.operationId,
			runtimeImage: release.image,
			runtimeVersion: release.version
		});
	}
});
