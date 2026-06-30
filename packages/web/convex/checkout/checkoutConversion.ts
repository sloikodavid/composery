import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { appendBoxEvent } from "../boxes/boxEvents";
import { beginBoxOperationRecord } from "../boxes/boxOperations";
import { assertSlugAvailable } from "../boxes/slugAvailability";
import { startWorkflow } from "../boxes/workflows/boxWorkflow";
import { CHECKOUT_INTENT_METADATA_KEYS } from "./checkoutIntents";

export const convertCheckoutIntentToBox = internalMutation({
	args: {
		intentId: v.id("box_checkout_intents"),
		polarCustomerId: v.string(),
		polarSubscriptionId: v.string(),
		runtimeImage: v.string()
	},
	handler: async (ctx, args) => {
		const intent = await ctx.db.get(args.intentId);
		if (!intent) throw new ConvexError("Checkout intent not found.");

		if (intent.status === "converted" && intent.box_id) {
			return { boxId: intent.box_id };
		}

		if (intent.status !== "active") {
			throw new ConvexError("Checkout intent is not active.");
		}

		await assertSlugAvailable(ctx, intent.slug, undefined, intent._id);

		const timestamp = Date.now();
		const boxId = await ctx.db.insert("boxes", {
			user_id: intent.user_id,
			slug: intent.slug,
			status: "provisioning",
			polar_customer_id: args.polarCustomerId,
			polar_subscription_id: args.polarSubscriptionId,
			runtime_image: args.runtimeImage,
			runtime_auth_hash: intent.runtime_auth_hash,
			created_at: timestamp,
			updated_at: timestamp
		});

		await ctx.db.patch(intent._id, {
			status: "converted",
			polar_customer_id: args.polarCustomerId,
			polar_subscription_id: args.polarSubscriptionId,
			converted_at: timestamp,
			box_id: boxId,
			updated_at: timestamp
		});

		const box = await ctx.db.get(boxId);
		if (!box) throw new ConvexError("Box creation failed.");

		const operationId = await beginBoxOperationRecord(ctx, box, {
			type: "provision",
			idempotencyKey: `provision:${boxId}`,
			targetStatus: "provisioning",
			metadata: {
				[CHECKOUT_INTENT_METADATA_KEYS.intentId]: intent._id
			}
		});
		if (!operationId)
			throw new ConvexError("Provision operation already exists.");

		await appendBoxEvent(ctx, box, "box.provisioning_started", {
			metadata: { operationId }
		});

		await startWorkflow(
			ctx,
			internal.boxes.workflows.provisionBox.provisionBox,
			{
				boxId,
				operationId
			}
		);

		return { boxId };
	}
});
