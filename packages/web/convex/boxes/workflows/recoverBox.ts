import { internal } from "../../_generated/api";
import { defineBoxWorkflow } from "./boxWorkflow";

// A repair never changes what the box IS - a broken box and a repaired one are
// both "running" - so both paths land back there. `repairing` exists only to
// make the attempt visible while it runs; the outcome is carried by the
// operation record, which the Repair dialog reads.
export const recoverBox = defineBoxWorkflow({
	onFailure: { eventType: "box.recovery_failed", targetBoxStatus: "running" },
	run: async (step, args) => {
		await step.runAction(
			internal.boxes.infra.ssh.repairRuntime,
			{ boxId: args.boxId },
			{ retry: true }
		);

		await step.runMutation(internal.boxes.boxStatus.markRepairSucceeded, {
			boxId: args.boxId,
			operationId: args.operationId
		});
	}
});
