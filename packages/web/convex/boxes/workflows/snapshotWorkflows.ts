import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { vSnapshotClass } from "../../schema";
import { snapshotPollOutcome, snapshotSizeBytes } from "../snapshotPolicy";
import { defineBoxWorkflow, operationError } from "./boxWorkflow";

// Capture holds the single-active-operation lock: a Hetzner `create_image` is a
// server action and Hetzner serializes server actions, so a concurrent
// reset/restore would get a raw "server has a running action" error. The box
// stays `running` throughout. Records failure on the row then re-throws so the
// wrapper marks the operation failed and emits one `box.snapshot_failed` event.
export const captureSnapshot = defineBoxWorkflow({
	extraArgs: { class: vSnapshotClass },
	type: "snapshot",
	run: async (step, args) => {
		const box = await step.runQuery(
			internal.boxes.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		if (!box.hetzner_server_id) {
			throw new Error("Box has no Hetzner server to snapshot.");
		}

		const { snapshotRowId } = await step.runMutation(
			internal.boxes.snapshots.beginSnapshot,
			{ boxId: args.boxId, class: args.class }
		);

		try {
			const { imageId, actionId } = await step.runAction(
				internal.boxes.infra.hetznerVps.createSnapshotImage,
				{
					serverId: box.hetzner_server_id,
					slug: box.slug,
					snapshotClass: args.class
				},
				{ retry: true }
			);
			await step.runMutation(internal.boxes.snapshots.markCreating, {
				snapshotRowId,
				imageId,
				actionId
			});

			let waited = 0;
			for (;;) {
				const action = await step.runAction(
					internal.boxes.infra.hetznerVps.getAction,
					{ actionId },
					{ retry: true }
				);
				const outcome = snapshotPollOutcome({
					error: action.error,
					status: action.status,
					waitedMs: waited
				});
				if (outcome.type === "complete") break;
				if (outcome.type === "failed") throw new Error(outcome.error);
				await step.sleep(outcome.delayMs);
				waited += outcome.delayMs;
			}

			const image = await step.runAction(
				internal.boxes.infra.hetznerVps.getImage,
				{ imageId },
				{ retry: true }
			);
			await step.runMutation(internal.boxes.snapshots.completeSnapshot, {
				snapshotRowId,
				operationId: args.operationId,
				sizeBytes: snapshotSizeBytes(image.imageSizeGb)
			});
		} catch (error) {
			await step.runMutation(internal.boxes.snapshots.failSnapshot, {
				snapshotRowId,
				error: operationError(error)
			});
			throw error;
		}
	}
});

// Restore rebuilds the VPS disk from the snapshot image, then re-bootstraps so
// the box's current password/slug are reconciled onto the restored disk.
export const restoreBox = defineBoxWorkflow({
	extraArgs: { snapshotRowId: v.id("box_snapshots") },
	type: "restore",
	run: async (step, args) => {
		const box = await step.runQuery(
			internal.boxes.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		if (!box.hetzner_server_id) {
			throw new Error("Box has no Hetzner server to restore.");
		}

		const target = await step.runQuery(
			internal.boxes.snapshots.snapshotRestoreTarget,
			{ snapshotRowId: args.snapshotRowId }
		);
		if (!target) throw new Error("Snapshot is not restorable.");

		await step.runAction(
			internal.boxes.infra.hetznerVps.rebuildServer,
			{ serverId: box.hetzner_server_id, image: target.imageId },
			{ retry: true }
		);

		await step.runAction(
			internal.boxes.infra.ssh.bootstrapRuntime,
			{ boxId: args.boxId },
			{ retry: true }
		);
		await step.runMutation(internal.boxes.snapshots.markRestoreSucceeded, {
			boxId: args.boxId,
			operationId: args.operationId,
			snapshotRowId: args.snapshotRowId
		});
	}
});
