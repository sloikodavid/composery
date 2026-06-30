import { internal } from "../../_generated/api";
import { rebuildRuntime } from "./runtimeLifecycle";
import { defineBoxWorkflow } from "./boxWorkflow";

export const resetBox = defineBoxWorkflow({
	onFailure: { eventType: "box.reset_failed", targetBoxStatus: "reset_failed" },
	run: async (step, args) => {
		const box = await step.runQuery(
			internal.boxes.boxQueries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		await rebuildRuntime(step, box);

		await step.runMutation(internal.boxes.boxStatus.markResetSucceeded, {
			boxId: args.boxId,
			operationId: args.operationId
		});
	}
});
