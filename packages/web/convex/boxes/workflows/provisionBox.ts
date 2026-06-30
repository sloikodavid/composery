import { internal } from "../../_generated/api";
import { createRuntime } from "./runtimeLifecycle";
import { defineBoxWorkflow } from "./boxWorkflow";

export const provisionBox = defineBoxWorkflow({
	onFailure: {
		eventType: "box.provisioning_failed",
		targetBoxStatus: "provisioning_failed"
	},
	run: async (step, args) => {
		const box = await step.runQuery(
			internal.boxes.boxQueries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		const runtimeImage = await step.runAction(
			internal.boxes.infra.runtimeImages.resolveRuntimeImage,
			{ image: box.runtime_image },
			{ retry: true }
		);

		await step.runMutation(internal.boxes.boxStatus.setRuntimeImage, {
			boxId: args.boxId,
			runtimeImage
		});

		await createRuntime(step, args.boxId, box.slug);

		await step.runMutation(internal.boxes.boxStatus.markProvisionSucceeded, {
			boxId: args.boxId,
			operationId: args.operationId
		});
	}
});
