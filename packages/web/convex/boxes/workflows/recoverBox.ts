import { internal } from "../../_generated/api";
import { defineBoxWorkflow } from "./boxWorkflow";

export const recoverBox = defineBoxWorkflow({
	onFailure: { eventType: "box.recovery_failed" },
	run: async (step, args) => {
		await step.runAction(
			internal.boxes.infra.ssh.repairRuntime,
			{ boxId: args.boxId },
			{ retry: true }
		);
	}
});
