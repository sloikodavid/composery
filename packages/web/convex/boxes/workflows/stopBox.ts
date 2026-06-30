import { internal } from "../../_generated/api";
import { defineBoxWorkflow } from "./boxWorkflow";

export const stopBox = defineBoxWorkflow({
	onFailure: { eventType: "box.stop_failed", targetBoxStatus: "running" },
	run: async (step, args) => {
		const box = await step.runQuery(
			internal.boxes.boxQueries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		await step.runAction(
			internal.boxes.infra.hetznerVps.stopServer,
			{ serverId: box.hetzner_server_id },
			{ retry: true }
		);

		await step.runMutation(
			internal.boxes.boxStatus.setBoxStatusWithOperationSucceeded,
			{
				boxId: args.boxId,
				operationId: args.operationId,
				status: "stopped",
				eventType: "box.stopped"
			}
		);
	}
});
