import { internal } from "../../_generated/api";
import { defineBoxWorkflow } from "./boxWorkflow";

export const unsuspendBox = defineBoxWorkflow({
	onFailure: {
		eventType: "box.unsuspend_failed",
		targetBoxStatus: "suspended"
	},
	run: async (step, args) => {
		const box = await step.runQuery(
			internal.boxes.boxQueries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		await step.runAction(
			internal.boxes.infra.hetznerVps.powerOnServer,
			{ serverId: box.hetzner_server_id },
			{ retry: true }
		);

		await step.runMutation(
			internal.boxes.boxStatus.setBoxStatusWithOperationSucceeded,
			{
				boxId: args.boxId,
				operationId: args.operationId,
				status: "running",
				eventType: "box.unsuspended"
			}
		);
	}
});
