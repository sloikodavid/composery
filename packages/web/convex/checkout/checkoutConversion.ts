import { ConvexError, v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { appendBoxEvent } from "../boxes/events";
import { boxEventType } from "../boxes/operationRules";
import { reconcileCapacityAlert } from "../boxes/capacityAlerts";
import { startBoxOperation } from "../boxes/operations";
import { isSlugAvailable } from "../boxes/slugAvailability";
import {
	billingRecordPurgeAt,
	terminalCheckoutSecretPatch
} from "../boxes/retention";
import { CHECKOUT_INTENT_METADATA_KEYS } from "./checkoutIntents";
import { capacityBlockMessage, readCapacityUsage } from "../boxes/capacity";
import { readGlobalSettings } from "../settings";
import { sendStaffAlert } from "../staffAlerts";

export const convertCheckoutIntentToBox = internalMutation({
	args: {
		intentId: v.id("box_checkout_intents"),
		polarCustomerId: v.string(),
		polarOrderId: v.string(),
		polarSubscriptionId: v.string(),
		runtimeImage: v.string()
	},
	handler: async (ctx, args) => {
		const intent = await ctx.db.get(args.intentId);
		if (!intent) throw new ConvexError("Checkout intent not found.");

		if (intent.box_id) {
			return { boxId: intent.box_id, unfulfilled: null };
		}

		// Terminal releases must never be resurrected by a re-delivered webhook.
		if (intent.release_reason === "slug_conflict") {
			return {
				boxId: null,
				unfulfilled: {
					comment: "The selected Composery box slug was no longer available.",
					idempotencyKey: `slug-conflict:${intent._id}`,
					orderId: args.polarOrderId,
					subscriptionId: args.polarSubscriptionId
				}
			};
		}
		if (intent.release_reason === "account_deleted") {
			return {
				boxId: null,
				unfulfilled: {
					comment:
						"The Composery account was deleted before fulfillment finished.",
					idempotencyKey: `account-deleted:${intent._id}`,
					orderId: args.polarOrderId,
					subscriptionId: args.polarSubscriptionId
				}
			};
		}
		if (intent.release_reason === "order_fully_refunded") {
			return { boxId: null, unfulfilled: null };
		}
		if (intent.release_reason === "capacity_unavailable") {
			return {
				boxId: null,
				unfulfilled: {
					comment:
						"Composery infrastructure capacity was no longer available when the paid checkout arrived.",
					idempotencyKey: `capacity-unavailable:${intent._id}`,
					orderId: args.polarOrderId,
					subscriptionId: args.polarSubscriptionId
				}
			};
		}

		// An active intent already owns one server and its full snapshot allowance.
		// A late paid event for an expired/released intent has lost that reservation,
		// so it must atomically reacquire capacity before becoming a box.
		if (intent.status !== "active") {
			const settings = await readGlobalSettings(ctx);
			const capacity = await readCapacityUsage(ctx, settings);
			if (!capacity.checkoutAvailable) {
				const timestamp = Date.now();
				await ctx.db.patch(intent._id, {
					status: "released",
					release_reason: "capacity_unavailable",
					released_at: timestamp,
					purge_at: billingRecordPurgeAt(timestamp),
					...terminalCheckoutSecretPatch(),
					polar_customer_id: args.polarCustomerId,
					polar_subscription_id: args.polarSubscriptionId,
					updated_at: timestamp
				});
				await sendStaffAlert(ctx, {
					key: `paid-checkout-capacity:${intent._id}`,
					severity: "critical",
					subject: `Paid checkout for "${intent.slug}" exceeded capacity`,
					text: `A late payment completed for checkout intent ${intent._id} after its capacity reservation ended. ${capacityBlockMessage(capacity.blockReason) ?? "No capacity remained."} Subscription ${args.polarSubscriptionId} is being revoked and its order refunded automatically in Polar.`
				});
				await reconcileCapacityAlert(ctx);
				return {
					boxId: null,
					unfulfilled: {
						comment:
							"Composery infrastructure capacity was no longer available when the paid checkout arrived.",
						idempotencyKey: `capacity-unavailable:${intent._id}`,
						orderId: args.polarOrderId,
						subscriptionId: args.polarSubscriptionId
					}
				};
			}
		}

		// This mutation only runs off order.paid, which is proof of payment, so a
		// lapsed reservation ("expired"/"released" without a box)
		// still converts. The slug is the product's identity: if it was taken
		// while the payment completed, the sale fails - the subscription is
		// revoked and staff refund the charge - rather than creating a box under
		// a name the customer didn't choose. Revoke and refund automatically;
		// this is another initial-fulfillment failure, not a support TODO.
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
			await sendStaffAlert(ctx, {
				key: `paid-checkout-slug:${intent._id}`,
				severity: "critical",
				subject: `Checkout for slug "${intent.slug}" could not be fulfilled`,
				text: `A payment completed for checkout intent ${intent._id} (user ${intent.user_id}), but slug "${intent.slug}" was taken before fulfillment. Subscription ${args.polarSubscriptionId} is being revoked and its order refunded automatically in Polar.`
			});
			return {
				boxId: null,
				unfulfilled: {
					comment: "The selected Composery box slug was no longer available.",
					idempotencyKey: `slug-conflict:${intent._id}`,
					orderId: args.polarOrderId,
					subscriptionId: args.polarSubscriptionId
				}
			};
		}

		const timestamp = Date.now();
		const boxId = await ctx.db.insert("boxes", {
			user_id: intent.user_id,
			slug: intent.slug,
			status: "creating",
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
			purge_at: billingRecordPurgeAt(timestamp),
			...terminalCheckoutSecretPatch(),
			updated_at: timestamp
		});
		await reconcileCapacityAlert(ctx);

		const box = await ctx.db.get(boxId);
		if (!box) throw new ConvexError("Box creation failed.");

		const operationId = await startBoxOperation(ctx, boxId, "create", {
			idempotencyKey: `create:${boxId}`,
			metadata: {
				[CHECKOUT_INTENT_METADATA_KEYS.intentId]: intent._id
			},
			trigger: "owner"
		});
		if (!operationId)
			throw new ConvexError("Provision operation already exists.");

		await appendBoxEvent(ctx, box, boxEventType("create", "started"), {
			metadata: { operationId }
		});

		return { boxId, unfulfilled: null };
	}
});
