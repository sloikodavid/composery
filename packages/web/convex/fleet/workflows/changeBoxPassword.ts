import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { defineBoxWorkflow } from "./boxWorkflow";

export const changeBoxPassword = defineBoxWorkflow({
	extraArgs: { runtimeAuthHash: v.string() },
	type: "change_password",
	run: async (step, args) => {
		await step.runAction(
			internal.fleet.infra.ssh.rewritePasswordAndRestart,
			{
				boxId: args.boxId,
				runtimeAuthHash: args.runtimeAuthHash
			},
			{ retry: true }
		);

		await step.runMutation(internal.fleet.lifecycle.updateRuntimeAuthHash, {
			boxId: args.boxId,
			operationId: args.operationId,
			runtimeAuthHash: args.runtimeAuthHash
		});
	}
});
