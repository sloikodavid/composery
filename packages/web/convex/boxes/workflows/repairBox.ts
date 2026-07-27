import { internal } from "../../_generated/api";
import { defineBoxWorkflow } from "./boxWorkflow";

// Repair - gives a box a clean host while keeping its files. It is the box's one
// recovery action: the owner never has to tell a wedged container apart from a
// broken host. Restore and Reset both give a clean disk but rewind or erase the
// files; Repair is the only path that keeps them. A host the owner has damaged
// in a way no in-place fix can heal (broken Docker, a mangled boot disk, wrecked
// systemd/nftables) can only be cleaned by a fresh boot of the base image, and
// that wipes the boot disk holding the box's Docker volumes. So the files are
// parked on a transient Hetzner Volume, the server is rebuilt from
// HETZNER_BOX_IMAGE, and the files are copied back and verified before the
// volume is deleted. Rewriting the runtime files and force-recreating the
// containers on the fresh host (repairRuntime) is the final step, so a wedged
// container is healed by the same action.
//
// Crash safety rests on two things, both persisted on the box row:
//   * parking_volume_id, set the instant the volume exists and cleared only
//     after it is deleted, so an interrupted repair leaves a recoverable
//     pointer instead of an orphan (reconciliation reclaims any volume no live
//     box points at);
//   * parking_volume_stage, the one-way gate between the two halves. The
//     destructive server rebuild only runs after the copy onto the volume has
//     verified (stage crosses to "restoring"), and once there the copy direction
//     is fixed at volume -> server, so a resumed repair can never overwrite the
//     parked files with an empty server.
//
// No pre-repair Hetzner snapshot is taken: the verified parking volume is the
// safety net, and a snapshot would burn a per-box snapshot slot (which gates
// fleet-wide checkout capacity) and cannot even capture the attached volume. An
// owner who wants belt-and-braces can take a manual snapshot first.
export const repairBox = defineBoxWorkflow({
	type: "repair",
	run: async (step, args) => {
		const box = await step.runQuery(
			internal.boxes.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		if (!box.hetzner_server_id) {
			throw new Error("Box has no Hetzner server to repair.");
		}
		if (!box.hetzner_location) {
			throw new Error("Box has no Hetzner location for its parking volume.");
		}
		const serverId = box.hetzner_server_id;

		// PARKING PHASE. The box's own server still holds the authoritative files;
		// nothing destructive has happened. Skipped entirely when a resumed repair
		// has already crossed into "restoring".
		let volumeId = box.parking_volume_id;
		if (box.parking_volume_stage !== "restoring") {
			if (volumeId === undefined) {
				// Precondition, checked once up front: the host must answer over SSH.
				await step.runAction(
					internal.boxes.infra.ssh.requireReachableHost,
					{ boxId: args.boxId },
					{ retry: true }
				);
				const { usedBytes } = await step.runAction(
					internal.boxes.infra.ssh.measureParkingUsage,
					{ boxId: args.boxId },
					{ retry: true }
				);
				const created = await step.runAction(
					internal.boxes.infra.hetznerVps.createParkingVolume,
					{ slug: box.slug, location: box.hetzner_location, usedBytes },
					{ retry: true }
				);
				volumeId = created.volumeId;
				// Persist the id before a single byte is copied, so a crash from here on
				// can never orphan the volume.
				await step.runMutation(internal.boxes.status.recordParkingVolume, {
					boxId: args.boxId,
					volumeId
				});
			}
			await step.runAction(
				internal.boxes.infra.hetznerVps.attachParkingVolume,
				{ volumeId, serverId },
				{ retry: true }
			);
			await step.runAction(
				internal.boxes.infra.ssh.copyToParking,
				{ boxId: args.boxId, volumeId },
				{ retry: true }
			);
			// Verify the copy while the box's files still exist, before anything
			// irreversible. "rsync exited 0" is not proof; this compares the trees.
			await step.runAction(
				internal.boxes.infra.ssh.verifyParkingCopy,
				{ boxId: args.boxId, volumeId },
				{ retry: true }
			);
			// The one-way gate: only now is the volume authoritative and the
			// destructive rebuild permitted.
			await step.runMutation(internal.boxes.status.markParkingRestoring, {
				boxId: args.boxId
			});
		}

		if (volumeId === undefined) {
			// A box in "restoring" must have a parking volume. If the pointer is gone
			// the recovery data cannot be found, so fail loudly rather than proceed.
			throw new Error(
				"Repair is mid-restore but its parking volume pointer is gone."
			);
		}

		// RESTORING PHASE. The parking volume holds the only copy of the files, so
		// nothing copies server -> volume from here on.
		//
		// Detach before the rebuild deliberately: it makes the operation correct
		// whether or not a Hetzner rebuild would have preserved the attachment,
		// rather than resting on an assumption about Hetzner's behaviour.
		await step.runAction(
			internal.boxes.infra.hetznerVps.detachParkingVolume,
			{ volumeId },
			{ retry: true }
		);
		const server = await step.runAction(
			internal.boxes.infra.hetznerVps.rebuildServer,
			{ serverId },
			{ retry: true }
		);
		await step.runMutation(internal.boxes.status.recordServerRebuilt, {
			boxId: args.boxId,
			serverId: server.serverId,
			serverType: server.serverType,
			location: server.location,
			ipv4: server.ipv4,
			ipv6: server.ipv6
		});
		await step.runAction(
			internal.boxes.infra.hetznerVps.attachParkingVolume,
			{ volumeId, serverId },
			{ retry: true }
		);
		await step.runAction(
			internal.boxes.infra.ssh.copyFromParking,
			{ boxId: args.boxId, volumeId },
			{ retry: true }
		);
		await step.runAction(
			internal.boxes.infra.ssh.verifyParkingBack,
			{ boxId: args.boxId, volumeId },
			{ retry: true }
		);

		// Copy-back verified: the fresh host now holds files identical to the ones
		// parked (and so identical to the originals, which were verified equal to
		// the parked copy before the rebuild). The volume is redundant, so unmount,
		// detach, and delete it - then clear the pointer - before the final
		// bring-up, exactly as the ordered steps require.
		await step.runAction(
			internal.boxes.infra.ssh.unmountParking,
			{ boxId: args.boxId },
			{ retry: true }
		);
		await step.runAction(
			internal.boxes.infra.hetznerVps.detachParkingVolume,
			{ volumeId },
			{ retry: true }
		);
		await step.runAction(
			internal.boxes.infra.hetznerVps.deleteParkingVolume,
			{ volumeId },
			{ retry: true }
		);
		await step.runMutation(internal.boxes.status.clearParkingVolume, {
			boxId: args.boxId
		});

		// Rewrite the runtime files, force-recreate the stack, and hold until the
		// editor answers, so a reported success means the box genuinely serves.
		await step.runAction(
			internal.boxes.infra.ssh.repairRuntime,
			{ boxId: args.boxId },
			{ retry: true }
		);
		await step.runMutation(internal.boxes.status.markRepairSucceeded, {
			boxId: args.boxId,
			operationId: args.operationId
		});
	}
});
