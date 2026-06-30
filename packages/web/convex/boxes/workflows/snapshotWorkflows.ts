import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { vSnapshotClass } from "../../schema";
import {
	SNAPSHOT_CAPTURE_DEADLINE_MS,
	snapshotPollDelayMs
} from "../snapshotPolicy";
import { defineBoxWorkflow } from "./boxWorkflow";

// Capture holds the single-active-operation lock: a Hetzner `create_image` is a
// server action and Hetzner serializes server actions, so a concurrent
// reset/restore would get a raw "server has a running action" error. The box
// stays `running` throughout. Records failure on the row then re-throws so the
// wrapper marks the operation failed and emits one `box.snapshot_failed` event.
export const captureSnapshot = defineBoxWorkflow({
	extraArgs: { class: vSnapshotClass },
	onFailure: { eventType: "box.snapshot_failed" },
	run: async (step, args) => {
		const box = await step.runQuery(
			internal.boxes.boxQueries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		if (!box.hetzner_server_id) {
			throw new Error("Box has no Hetzner server to snapshot.");
		}

		const { snapshotRowId } = await step.runMutation(
			internal.boxes.boxSnapshots.beginSnapshot,
			{ boxId: args.boxId, class: args.class }
		);

		try {
			const description = `composery-web ${box.slug} ${args.class} ${new Date().toISOString()}`;
			const { imageId, actionId } = await step.runAction(
				internal.boxes.infra.hetznerVps.createSnapshotImage,
				{ serverId: box.hetzner_server_id, slug: box.slug, description },
				{ retry: true }
			);
			await step.runMutation(internal.boxes.boxSnapshots.markCreating, {
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
				if (action.status === "success") break;
				if (action.status === "error") {
					throw new Error(action.error ?? "Hetzner snapshot creation failed.");
				}
				if (waited >= SNAPSHOT_CAPTURE_DEADLINE_MS) {
					throw new Error(
						"Snapshot creation did not finish before the deadline."
					);
				}
				const delay = snapshotPollDelayMs(waited);
				await step.sleep(delay);
				waited += delay;
			}

			const image = await step.runAction(
				internal.boxes.infra.hetznerVps.getImage,
				{ imageId },
				{ retry: true }
			);
			await step.runMutation(internal.boxes.boxSnapshots.completeSnapshot, {
				snapshotRowId,
				operationId: args.operationId,
				sizeBytes: image.imageSizeGb
					? Math.round(image.imageSizeGb * 1e9)
					: undefined
			});
		} catch (error) {
			await step.runMutation(internal.boxes.boxSnapshots.failSnapshot, {
				snapshotRowId,
				error: error instanceof Error ? error.message : String(error)
			});
			throw error;
		}
	}
});

// Restore rebuilds the VPS disk from the snapshot image, then re-bootstraps so
// the box's current password/slug are reconciled onto the restored disk.
export const restoreBox = defineBoxWorkflow({
	extraArgs: { snapshotRowId: v.id("box_snapshots") },
	onFailure: {
		eventType: "box.restore_failed",
		targetBoxStatus: "restore_failed"
	},
	run: async (step, args) => {
		const box = await step.runQuery(
			internal.boxes.boxQueries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		if (!box.hetzner_server_id) {
			throw new Error("Box has no Hetzner server to restore.");
		}

		const target = await step.runQuery(
			internal.boxes.boxSnapshots.snapshotRestoreTarget,
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

		await step.runMutation(internal.boxes.boxSnapshots.markRestoreSucceeded, {
			boxId: args.boxId,
			operationId: args.operationId,
			snapshotRowId: args.snapshotRowId
		});
	}
});
