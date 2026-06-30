import type { PolarWebhookEvent } from "@convex-dev/polar";
import { httpRouter } from "convex/server";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { startBoxOperation } from "../boxes/boxOperations";
import { CHECKOUT_INTENT_METADATA_KEYS } from "../checkout/checkoutIntents";
import { requiredEnv } from "../env";
import { polarServer } from "./polar";

const http = httpRouter();

type RouteCtx = Pick<ActionCtx, "runMutation" | "runQuery">;
type PolarSubscription = Extract<
	PolarWebhookEvent,
	{ type: "subscription.active" }
>["data"];

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

async function intentIdFromSubscription(
	ctx: RouteCtx,
	subscription: PolarSubscription
) {
	const metadata = subscription.metadata ?? {};
	const metadataIntentId =
		metadata[CHECKOUT_INTENT_METADATA_KEYS.intentId] ??
		metadata.intentId ??
		metadata.checkout_intent_id;

	if (typeof metadataIntentId === "string") {
		return metadataIntentId as Id<"box_checkout_intents">;
	}

	if (!subscription.checkoutId) return null;

	return await ctx.runQuery(
		internal.checkout.checkoutIntents.checkoutIntentIdByPolarCheckout,
		{
			checkoutId: subscription.checkoutId
		}
	);
}

async function startDeleteWorkflow(
	ctx: RouteCtx,
	boxId: Id<"boxes">,
	subscriptionId: string
) {
	await startBoxOperation(ctx, boxId, "delete", {
		idempotencyKey: `delete:${subscriptionId}`
	});
}

polarServer().registerRoutes(http, {
	events: {
		"subscription.active": async (ctx, event) => {
			await syncSubscription(ctx, event.data);

			const intentId = await intentIdFromSubscription(ctx, event.data);
			if (!intentId) return;

			await ctx.runMutation(
				internal.checkout.checkoutConversion.convertCheckoutIntentToBox,
				{
					intentId,
					polarCustomerId: event.data.customerId,
					polarSubscriptionId: event.data.id,
					runtimeImage: requiredEnv("RUNTIME_IMAGE")
				}
			);
		},
		"subscription.revoked": async (ctx, event) => {
			await syncSubscription(ctx, event.data);

			const boxId = await ctx.runQuery(
				internal.boxes.boxQueries.boxIdBySubscription,
				{
					subscriptionId: event.data.id
				}
			);
			if (!boxId) return;

			await startDeleteWorkflow(ctx, boxId, event.data.id);
		},
		"checkout.expired": async (ctx, event) => {
			await ctx.runMutation(
				internal.checkout.checkoutIntents.releaseCheckoutIntentByPolarCheckout,
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
				internal.checkout.checkoutIntents.releaseCheckoutIntentByPolarCheckout,
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

export default http;
