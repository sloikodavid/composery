import { internal } from "../../_generated/api";
import { vRecoveryType } from "../boxRecoveryTypes";
import { defineBoxWorkflow } from "./boxWorkflow";

export const recoverBox = defineBoxWorkflow({
	extraArgs: { type: vRecoveryType },
	onFailure: { eventType: "box.recovery_failed" },
	run: async (step, args) => {
		await step.runAction(internal.boxes.boxRecovery.run, {
			boxId: args.boxId,
			type: args.type
		});
	}
});
