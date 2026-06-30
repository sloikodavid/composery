import { internal } from "../../_generated/api";
import { defineBoxWorkflow } from "./boxWorkflow";

// Suspension powers the whole VPS off at the provider, not just the container,
// so it holds even against a user who escaped the container or broke the box.
export const suspendBox = defineBoxWorkflow({
	onFailure: { eventType: "box.suspend_failed", targetBoxStatus: "running" },
	run: async (step, args) => {
		const box = await step.runQuery(
			internal.boxes.boxQueries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		await step.runAction(
			internal.boxes.infra.hetznerVps.powerOffServer,
			{ serverId: box.hetzner_server_id },
			{ retry: true }
		);

		await step.runMutation(
			internal.boxes.boxStatus.setBoxStatusWithOperationSucceeded,
			{
				boxId: args.boxId,
				operationId: args.operationId,
				status: "suspended",
				eventType: "box.suspended"
			}
		);
	}
});
