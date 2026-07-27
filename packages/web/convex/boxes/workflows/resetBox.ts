import { internal } from "../../_generated/api";
import { rebuildRuntime } from "./runtimeLifecycle";
import { defineBoxWorkflow } from "./boxWorkflow";

export const resetBox = defineBoxWorkflow({
	type: "reset",
	run: async (step, args) => {
		const box = await step.runQuery(
			internal.boxes.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		await rebuildRuntime(step, box);

		await step.runMutation(internal.boxes.status.markResetSucceeded, {
			boxId: args.boxId,
			operationId: args.operationId
		});
	}
});
