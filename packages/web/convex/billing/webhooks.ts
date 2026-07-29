import type { PolarWebhookEvent } from "@convex-dev/polar";
import type { HttpRouter } from "convex/server";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { startBoxOperation } from "../boxes/operations";
import { CHECKOUT_INTENT_METADATA_KEYS } from "../checkout/checkoutIntents";
import { requiredEnv } from "../env";
import { TERMS_FIELD_SLUG } from "../../lib/cloud-legal";
import {
	boxSellableForProductId,
	polarServer,
	revokeAndRefundPolarOrder,
	revokePolarSubscription
} from "./polar";

// What these handlers need from their context, and nothing more: they read and
// they write. Polar dispatches them with either a mutation or an action context,
// and an action's signatures are the narrower pair, so naming those accepts both.
//
// Spelled out rather than borrowed from `startBoxOperation`'s parameter, which is
// what it used to be: that tied every reader here to whatever one helper happened
// to require, so narrowing the helper broke handlers that never called it.
type RouteCtx = {
	runQuery: ActionCtx["runQuery"];
	runMutation: ActionCtx["runMutation"];
};
type PolarSubscription = Extract<
	PolarWebhookEvent,
	{ type: "subscription.active" }
>["data"];
type PolarOrder = Extract<PolarWebhookEvent, { type: "order.paid" }>["data"];

function date(value: Date | null | undefined) {
	return value ? value.toISOString() : null;
}

function subscriptionForComponent(subscription: PolarSubscription) {
	return {
		id: subscription.id,
		customerId: subscription.customerId,
		createdAt: subscription.createdAt.toISOString(),
		modifiedAt: date(subscription.modifiedAt),
		amount: subscription.amount,
		currency: subscription.currency,
		recurringInterval: subscription.recurringInterval,
		status: subscription.status,
		currentPeriodStart: subscription.currentPeriodStart.toISOString(),
		currentPeriodEnd: date(subscription.currentPeriodEnd),
		cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
		startedAt: date(subscription.startedAt),
		endedAt: date(subscription.endedAt),
		productId: subscription.productId,
		priceId: subscription.prices?.[0]?.id,
		checkoutId: subscription.checkoutId,
		metadata: subscription.metadata ?? {},
		customerCancellationReason: subscription.customerCancellationReason,
		customerCancellationComment: subscription.customerCancellationComment,
		discountId: subscription.discountId,
		canceledAt: date(subscription.canceledAt),
		endsAt: date(subscription.endsAt),
		recurringIntervalCount: subscription.recurringIntervalCount,
		trialStart: date(subscription.trialStart),
		trialEnd: date(subscription.trialEnd),
		seats: subscription.seats ?? null,
		customFieldData: subscription.customFieldData
	};
}

async function syncSubscription(
	ctx: RouteCtx,
	subscription: PolarSubscription
) {
	await ctx.runMutation(components.polar.lib.updateSubscription, {
		subscription: subscriptionForComponent(subscription)
	});
}

async function intentIdFromCheckoutMetadata(
	ctx: RouteCtx,
	metadata: Record<string, unknown>,
	checkoutId: string | null | undefined
) {
	const metadataIntentId =
		metadata[CHECKOUT_INTENT_METADATA_KEYS.intentId] ??
		metadata.intentId ??
		metadata.checkout_intent_id;

	if (typeof metadataIntentId === "string" && metadataIntentId) {
		const intentId = await ctx.runQuery(
			internal.checkout.checkoutIntents.checkoutIntentIdFromString,
			{ intentId: metadataIntentId }
		);
		if (intentId) return intentId;
	}

	if (!checkoutId) return null;

	return await ctx.runQuery(
		internal.checkout.checkoutIntents.checkoutIntentIdByPolarCheckout,
		{
			checkoutId
		}
	);
}

async function intentIdFromOrder(ctx: RouteCtx, order: PolarOrder) {
	return await intentIdFromCheckoutMetadata(
		ctx,
		order.metadata,
		order.checkoutId
	);
}

function checkedCustomField(
	customFieldData: Record<string, unknown> | undefined,
	slug: string
) {
	return customFieldData?.[slug] === true;
}

async function startDeleteWorkflow(
	ctx: RouteCtx,
	boxId: Id<"boxes">,
	subscriptionId: string
) {
	await startBoxOperation(ctx, boxId, "delete", {
		idempotencyKey: `delete:${subscriptionId}`,
		trigger: "system:subscription_revoked"
	});
}

export function registerPolarWebhookRoutes(http: HttpRouter) {
	polarServer().registerRoutes(http, {
		events: {
			"subscription.active": async (ctx, event) => {
				await syncSubscription(ctx, event.data);
			},
			"order.paid": async (ctx, event) => {
				const order = event.data;
				// What was paid for decides which machine gets provisioned, so the
				// plan is read off the order's product rather than off the reservation
				// that preceded it.
				const sellable = boxSellableForProductId(order.productId);
				if (!sellable) return;
				if (
					order.billingReason !== "subscription_create" ||
					!order.subscription ||
					!order.checkoutId
				) {
					return;
				}
				const intentId = await intentIdFromOrder(ctx, order);
				if (!intentId) {
					await ctx.runMutation(internal.staffAlerts.raise, {
						key: `paid-order-without-intent:${order.id}`,
						severity: "critical",
						subject: "Paid Polar order is not linked to a checkout",
						text: `Polar order ${order.id} completed for customer ${order.customerId} and subscription ${order.subscription.id}, but no Composery checkout intent matched checkout ${order.checkoutId}. Fulfillment did not start. Review the order and webhook metadata in Polar immediately.`
					});
					await revokeAndRefundPolarOrder({
						comment:
							"The paid order could not be linked to a Composery checkout intent.",
						idempotencyKey: `unmatched-checkout:${order.id}`,
						orderId: order.id,
						reason: "other",
						subscriptionId: order.subscription.id
					});
					return;
				}
				const termsAccepted = checkedCustomField(
					order.customFieldData,
					TERMS_FIELD_SLUG
				);
				if (!termsAccepted) {
					await ctx.runMutation(internal.staffAlerts.raise, {
						key: `paid-order-missing-terms:${order.id}`,
						severity: "critical",
						subject: "Paid Polar order is missing Terms acceptance",
						text: `Polar order ${order.id} completed for checkout intent ${intentId}, but the required supplier Terms checkbox was not present. The subscription is being revoked and the order refunded automatically.`
					});
					await revokeAndRefundPolarOrder({
						comment: "Required supplier Terms acceptance was missing.",
						idempotencyKey: `invalid-checkout:${order.id}`,
						orderId: order.id,
						reason: "other",
						subscriptionId: order.subscription.id
					});
					return;
				}

				const recorded = await ctx.runMutation(
					internal.checkout.checkoutIntents.recordInitialPaidOrder,
					{
						checkoutId: order.checkoutId,
						customerId: order.customerId,
						intentId,
						orderId: order.id,
						subscriptionId: order.subscription.id,
						termsAccepted,
						termsAcceptedAt: order.createdAt.getTime()
					}
				);
				if (
					recorded === "missing" ||
					recorded === "checkout_mismatch" ||
					recorded === "order_mismatch"
				) {
					await ctx.runMutation(internal.staffAlerts.raise, {
						key: `paid-order-intent-mismatch:${order.id}`,
						severity: "critical",
						subject: "Paid Polar order does not match its checkout intent",
						text: `Polar order ${order.id} could not be recorded on checkout intent ${intentId} (${recorded}). Fulfillment did not start. The subscription is being revoked and the order refunded automatically.`
					});
					await revokeAndRefundPolarOrder({
						comment: `The paid order did not match its Composery checkout intent (${recorded}).`,
						idempotencyKey: `checkout-intent-mismatch:${order.id}`,
						orderId: order.id,
						reason: "other",
						subscriptionId: order.subscription.id
					});
					return;
				}

				const conversion = await ctx.runMutation(
					internal.checkout.checkoutConversion.convertCheckoutIntentToBox,
					{
						intentId,
						plan: sellable.plan,
						polarCustomerId: order.customerId,
						polarOrderId: order.id,
						polarSubscriptionId: order.subscription.id,
						runtimeImage: requiredEnv("RUNTIME_IMAGE")
					}
				);
				if (conversion.unfulfilled) {
					await revokeAndRefundPolarOrder({
						...conversion.unfulfilled
					});
				}
			},
			"order.refunded": async (ctx, event) => {
				const order = event.data;
				if (order.refundableAmount !== 0 || !order.subscriptionId) {
					return;
				}

				const intentId = await intentIdFromOrder(ctx, order);
				const boxId = await ctx.runQuery(
					internal.boxes.queries.boxIdBySubscription,
					{ subscriptionId: order.subscriptionId }
				);
				if (!intentId && !boxId) return;
				if (intentId) {
					await ctx.runMutation(
						internal.checkout.checkoutIntents.releaseCheckoutIntent,
						{
							intentId,
							polarCheckoutStatus: "refunded",
							reason: "order_fully_refunded"
						}
					);
				}

				// Polar refunds and subscriptions are independent. A full cumulative
				// refund must not leave the box running or able to renew.
				await revokePolarSubscription(order.subscriptionId);
			},
			"subscription.revoked": async (ctx, event) => {
				await syncSubscription(ctx, event.data);

				const boxId = await ctx.runQuery(
					internal.boxes.queries.boxIdBySubscription,
					{
						subscriptionId: event.data.id
					}
				);
				if (!boxId) return;

				await startDeleteWorkflow(ctx, boxId, event.data.id);
			},
			"checkout.expired": async (ctx, event) => {
				await ctx.runMutation(
					internal.checkout.checkoutIntents
						.releaseCheckoutIntentByPolarCheckout,
					{
						checkoutId: event.data.id,
						polarCheckoutStatus: event.data.status,
						reason: "checkout_expired"
					}
				);
			},
			"checkout.updated": async (ctx, event) => {
				if (event.data.status !== "expired" && event.data.status !== "failed") {
					return;
				}

				await ctx.runMutation(
					internal.checkout.checkoutIntents
						.releaseCheckoutIntentByPolarCheckout,
					{
						checkoutId: event.data.id,
						polarCheckoutStatus: event.data.status,
						reason:
							event.data.status === "expired"
								? "checkout_expired"
								: "checkout_failed"
					}
				);
			}
		}
	});
}
