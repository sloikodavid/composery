import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { appendBoxEvent } from "../boxes/boxEvents";
import { emailStaff } from "../boxes/boxMetrics";
import { beginBoxOperationRecord } from "../boxes/boxOperations";
import { isSlugAvailable } from "../boxes/slugAvailability";
import {
	billingRecordPurgeAt,
	terminalCheckoutSecretPatch
} from "../boxes/boxRetention";
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

		if (intent.box_id) {
			return { boxId: intent.box_id };
		}

		// A slug conflict below already revoked this subscription; a re-delivered
		// subscription.active must not resurrect the sale once the slug frees up.
		if (intent.release_reason === "slug_conflict") {
			return { boxId: null };
		}

		// This mutation only runs off subscription.active, which is proof of
		// payment, so a lapsed reservation ("expired"/"released" without a box)
		// still converts. The slug is the product's identity: if it was taken
		// while the payment completed, the sale fails - the subscription is
		// revoked and staff refund the charge - rather than creating a box under
		// a name the customer didn't choose. Terminal either way, never a
		// webhook retry loop.
		if (!(await isSlugAvailable(ctx, intent.slug, { intentId: intent._id }))) {
			const timestamp = Date.now();
			await ctx.db.patch(intent._id, {
				status: "released",
				release_reason: "slug_conflict",
				released_at: timestamp,
				purge_at: billingRecordPurgeAt(timestamp),
				...terminalCheckoutSecretPatch(),
				polar_customer_id: args.polarCustomerId,
				polar_subscription_id: args.polarSubscriptionId,
				updated_at: timestamp
			});
			await ctx.scheduler.runAfter(
				0,
				internal.billing.polar.revokeSubscription,
				{
					subscriptionId: args.polarSubscriptionId
				}
			);
			await emailStaff(
				ctx,
				`Checkout for slug "${intent.slug}" revoked: slug taken`,
				`A payment completed for checkout intent ${intent._id} (user ${intent.user_id}), but slug "${intent.slug}" was taken before the subscription activated. The subscription ${args.polarSubscriptionId} has been revoked automatically - refund the charge in the Polar dashboard and let the customer know.`
			);
			return { boxId: null };
		}

		const timestamp = Date.now();
		const boxId = await ctx.db.insert("boxes", {
			user_id: intent.user_id,
			slug: intent.slug,
			status: "provisioning",
			polar_customer_id: args.polarCustomerId,
			polar_subscription_id: args.polarSubscriptionId,
			runtime_image: args.runtimeImage,
			created_at: timestamp,
			updated_at: timestamp
		});

		await ctx.db.patch(intent._id, {
			status: "converted",
			polar_customer_id: args.polarCustomerId,
			polar_subscription_id: args.polarSubscriptionId,
			converted_at: timestamp,
			box_id: boxId,
			...terminalCheckoutSecretPatch(),
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
