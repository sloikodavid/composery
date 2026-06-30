import { ConvexError } from "convex/values";
import type { Infer } from "convex/values";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
	internalMutation,
	type DatabaseReader,
	type DatabaseWriter
} from "../_generated/server";
import { vBoxBeginStatus, vBoxOperationType } from "../schema";
import {
	ACTIVE_OPERATION_STATUSES,
	isOperationAllowed
} from "./boxOperationRules";
import { assertSlugAvailable } from "./slugAvailability";
import { startWorkflow } from "./workflows/boxWorkflow";

type ReadDbCtx = { db: DatabaseReader };
type WriteDbCtx = { db: DatabaseWriter };
type OperationType = Infer<typeof vBoxOperationType>;
type StartArgs = Parameters<typeof startWorkflow>;

function assertOperationAllowed(box: Doc<"boxes">, type: OperationType) {
	if (!isOperationAllowed(box.status, type)) {
		throw new ConvexError(`Cannot start ${type} while box is ${box.status}.`);
	}
}

async function findActiveOperationByIdempotencyKey(
	ctx: ReadDbCtx,
	key: string
) {
	for (const status of ACTIVE_OPERATION_STATUSES) {
		const operation = await ctx.db
			.query("box_operations")
			.withIndex("idempotency_key_status", (query) =>
				query.eq("idempotency_key", key).eq("status", status)
			)
			.first();
		if (operation) return operation;
	}

	return null;
}

async function findActiveOperationForBox(ctx: ReadDbCtx, boxId: Id<"boxes">) {
	for (const status of ACTIVE_OPERATION_STATUSES) {
		const operation = await ctx.db
			.query("box_operations")
			.withIndex("box_id_status", (query) =>
				query.eq("box_id", boxId).eq("status", status)
			)
			.first();
		if (operation) return operation;
	}

	return null;
}

export async function beginBoxOperationRecord(
	ctx: WriteDbCtx,
	box: Doc<"boxes">,
	input: {
		idempotencyKey: string;
		metadata?: Record<string, unknown>;
		reservedSlug?: string;
		targetStatus?: Doc<"boxes">["status"];
		type: Doc<"box_operations">["type"];
	}
) {
	const existing = await findActiveOperationByIdempotencyKey(
		ctx,
		input.idempotencyKey
	);

	if (existing) {
		return null;
	}

	const activeOperation = await findActiveOperationForBox(ctx, box._id);
	if (activeOperation) {
		throw new ConvexError(
			"This box is busy with another operation. Try again in a moment."
		);
	}

	assertOperationAllowed(box, input.type);

	if (input.reservedSlug) {
		await assertSlugAvailable(ctx, input.reservedSlug, box._id);
	}

	const timestamp = Date.now();
	if (input.targetStatus) {
		await ctx.db.patch(box._id, {
			status: input.targetStatus,
			updated_at: timestamp
		});
	}

	const operationId = await ctx.db.insert("box_operations", {
		box_id: box._id,
		type: input.type,
		status: "pending",
		idempotency_key: input.idempotencyKey,
		reserved_slug: input.reservedSlug,
		metadata: input.metadata,
		created_at: timestamp,
		updated_at: timestamp
	});

	return operationId as Id<"box_operations">;
}

export const beginBoxOperation = internalMutation({
	args: {
		boxId: v.id("boxes"),
		idempotencyKey: v.string(),
		metadata: v.optional(v.record(v.string(), v.any())),
		reservedSlug: v.optional(v.string()),
		targetStatus: v.optional(vBoxBeginStatus),
		type: vBoxOperationType
	},
	handler: async (ctx, args) => {
		const box = await ctx.db.get(args.boxId);
		if (!box) throw new ConvexError("Box not found.");

		return await beginBoxOperationRecord(ctx, box, {
			idempotencyKey: args.idempotencyKey,
			metadata: args.metadata,
			reservedSlug: args.reservedSlug,
			targetStatus: args.targetStatus,
			type: args.type
		});
	}
});

// The one place that knows, per operation, which status the box moves to while
// the operation runs and which workflow carries it out. `satisfies` makes the
// table exhaustive: add an operation type to the schema and this won't compile
// until it has a plan. Callers only supply what genuinely varies - the
// idempotency key, and any reserved slug, metadata, or workflow arguments.
const BOX_OPERATION_PLANS = {
	provision: {
		targetStatus: "provisioning",
		workflow: internal.boxes.workflows.provisionBox.provisionBox
	},
	delete: {
		targetStatus: "deleting",
		workflow: internal.boxes.workflows.deleteBox.deleteBox
	},
	reset: {
		targetStatus: "resetting",
		workflow: internal.boxes.workflows.resetBox.resetBox
	},
	stop: {
		targetStatus: "stopping",
		workflow: internal.boxes.workflows.stopBox.stopBox
	},
	start: {
		targetStatus: "starting",
		workflow: internal.boxes.workflows.startBox.startBox
	},
	change_slug: {
		workflow: internal.boxes.workflows.changeBoxSlug.changeBoxSlug
	},
	change_password: {
		workflow: internal.boxes.workflows.changeBoxPassword.changeBoxPassword
	},
	suspend: {
		targetStatus: "suspending",
		workflow: internal.boxes.workflows.suspendBox.suspendBox
	},
	unsuspend: {
		targetStatus: "unsuspending",
		workflow: internal.boxes.workflows.unsuspendBox.unsuspendBox
	},
	restore: {
		targetStatus: "restoring",
		workflow: internal.boxes.workflows.snapshotWorkflows.restoreBox
	},
	snapshot: {
		workflow: internal.boxes.workflows.snapshotWorkflows.captureSnapshot
	}
} satisfies Record<
	OperationType,
	{ targetStatus?: Infer<typeof vBoxBeginStatus>; workflow: StartArgs[1] }
>;

export async function startBoxSuspension(
	ctx: StartArgs[0],
	input: {
		boxId: Id<"boxes">;
		idempotencyKeyPrefix: string;
		reason?: string;
		suspend: boolean;
	}
) {
	return await startBoxOperation(
		ctx,
		input.boxId,
		input.suspend ? "suspend" : "unsuspend",
		{
			idempotencyKey: `${input.idempotencyKeyPrefix}:${input.boxId}`,
			metadata: input.suspend ? { reason: input.reason } : undefined
		}
	);
}

export async function startBoxOperation(
	ctx: StartArgs[0],
	boxId: Id<"boxes">,
	type: OperationType,
	options: {
		idempotencyKey: string;
		reservedSlug?: string;
		metadata?: Record<string, unknown>;
		workflowArgs?: Record<string, unknown>;
	}
): Promise<Id<"box_operations"> | null> {
	const plan = BOX_OPERATION_PLANS[type];

	const operationId = await ctx.runMutation(
		internal.boxes.boxOperations.beginBoxOperation,
		{
			boxId,
			type,
			idempotencyKey: options.idempotencyKey,
			targetStatus: "targetStatus" in plan ? plan.targetStatus : undefined,
			reservedSlug: options.reservedSlug,
			metadata: options.metadata
		}
	);
	if (!operationId) return null;

	await startWorkflow(ctx, plan.workflow, {
		boxId,
		operationId,
		...options.workflowArgs
	} as StartArgs[2]);

	return operationId;
}
