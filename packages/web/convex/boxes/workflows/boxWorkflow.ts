import { WorkflowManager, type WorkflowCtx } from "@convex-dev/workflow";
import {
	type Infer,
	type ObjectType,
	type PropertyValidators,
	v
} from "convex/values";
import { components, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { vBoxFailureStatus } from "../../schema";

export const workflow = new WorkflowManager(components.workflow);

type StartParams = Parameters<typeof workflow.start>;

export async function startWorkflow(
	ctx: StartParams[0],
	workflowRef: StartParams[1],
	args: StartParams[2]
) {
	await workflow.start(ctx, workflowRef, args, { startAsync: true });
}

type BoxWorkflowArgs<Extra extends PropertyValidators> = {
	boxId: Id<"boxes">;
	operationId: Id<"box_operations">;
} & ObjectType<Extra>;

// Marks the operation running, runs the body, and on any throw records the
// failure against the operation and box before re-throwing. On a clean return
// it settles the operation as a safety net, in case the body forgot to close
// it - an unclosed operation would block every later action on the box.
export function defineBoxWorkflow<
	Extra extends PropertyValidators = Record<string, never>
>(config: {
	extraArgs?: Extra;
	onFailure: {
		eventType: string;
		targetBoxStatus?: Infer<typeof vBoxFailureStatus>;
	};
	run: (step: WorkflowCtx, args: BoxWorkflowArgs<Extra>) => Promise<void>;
}) {
	return workflow.define({
		args: {
			boxId: v.id("boxes"),
			operationId: v.id("box_operations"),
			...((config.extraArgs ?? {}) as Extra)
		},
		handler: async (step, args) => {
			const typedArgs = args as BoxWorkflowArgs<Extra>;
			await step.runMutation(internal.boxes.boxStatus.markOperationRunning, {
				operationId: typedArgs.operationId
			});

			try {
				await config.run(step, typedArgs);
			} catch (error) {
				await step.runMutation(internal.boxes.boxStatus.markOperationFailed, {
					boxId: typedArgs.boxId,
					operationId: typedArgs.operationId,
					error: error instanceof Error ? error.message : String(error),
					eventType: config.onFailure.eventType,
					targetBoxStatus: config.onFailure.targetBoxStatus
				});
				throw error;
			}

			await step.runMutation(internal.boxes.boxStatus.settleOperation, {
				operationId: typedArgs.operationId
			});
		}
	});
}
