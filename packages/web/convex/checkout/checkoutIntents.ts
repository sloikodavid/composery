import { ConvexError, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	type MutationCtx
} from "../_generated/server";
import { assertSlugAvailable } from "../boxes/slugAvailability";
import {
	billingRecordPurgeAt,
	terminalCheckoutSecretPatch,
	unpaidCheckoutPurgeAt
} from "../boxes/boxRetention";
import {
	MAX_ACTIVE_CHECKOUT_INTENTS_PER_USER,
	readGlobalSettings
} from "../settings";
import { CLOUD_TERMS_VERSION } from "../../lib/cloud-legal";
import { capacityBlockMessage, readCapacityUsage } from "../boxes/boxCapacity";
import { reconcileCapacityAlert } from "../boxes/capacityAlerts";

// Polar checkout metadata keys. Set when creating a checkout and read back from
// paid orders to reconnect a completed payment to the reserved intent.
export const CHECKOUT_INTENT_METADATA_KEYS = {
	// What the pricing page toggle was set to, not what was bought: Polar
	// checkout offers both products and the customer may switch. Analytics only
	// - the sold interval is the subscription's recurringInterval.
	selectedBillingInterval: "composery_selected_billing_interval",
	intentId: "composery_checkout_intent_id",
	slug: "composery_box_slug",
	userId: "composery_clerk_user_id"
} as const;

// runbook: Unpaid checkout reservation
export const CHECKOUT_RESERVATION_TTL_MS = 60 * 60 * 1000;

export function paidOrderRecordingStatus(
	intent: Pick<
		Doc<"box_checkout_intents">,
		| "box_id"
		| "polar_checkout_id"
		| "polar_initial_order_id"
		| "polar_subscription_id"
	> | null,
	args: { checkoutId: string; orderId: string; subscriptionId: string }
) {
	if (!intent) return "missing" as const;
	if (
		intent.polar_checkout_id &&
		intent.polar_checkout_id !== args.checkoutId
	) {
		return "checkout_mismatch" as const;
	}
	if (
		(intent.polar_initial_order_id &&
			intent.polar_initial_order_id !== args.orderId) ||
		(intent.polar_subscription_id &&
			intent.polar_subscription_id !== args.subscriptionId)
	) {
		return "order_mismatch" as const;
	}
	if (intent.box_id) return "already_fulfilled" as const;
	return "recorded" as const;
}

// How many of a user's oldest active reservations must yield so a new one fits
// under the cap. Zero while there is room.
export function reservationsToRelease(activeCount: number, cap: number) {
	if (
		!Number.isInteger(activeCount) ||
		activeCount < 0 ||
		activeCount > MAX_ACTIVE_CHECKOUT_INTENTS_PER_USER
	) {
		throw new RangeError("Active checkout reservation count is out of bounds");
	}
	if (
		!Number.isInteger(cap) ||
		cap < 1 ||
		cap > MAX_ACTIVE_CHECKOUT_INTENTS_PER_USER
	) {
		throw new RangeError("Checkout reservation limit is out of bounds");
	}
	return Math.max(0, activeCount - cap + 1);
}

// Every terminal transition of an unpaid intent looks the same: stop holding the
// slug and capacity, keep why, and schedule the purge.
async function releaseIntentDoc(
	ctx: MutationCtx,
	intent: Doc<"box_checkout_intents">,
	release: {
		polarCheckoutStatus?: string;
		reason: string;
		status: "expired" | "released";
	}
) {
	const timestamp = Date.now();
	await ctx.db.patch(intent._id, {
		status: release.status,
		polar_checkout_status: release.polarCheckoutStatus,
		released_at: timestamp,
		release_reason: release.reason,
		purge_at: unpaidCheckoutPurgeAt(timestamp),
		...terminalCheckoutSecretPatch(),
		updated_at: timestamp
	});
}

export const reserveCheckoutIntent = internalMutation({
	args: {
		slug: v.string(),
		userId: v.string()
	},
	handler: async (ctx, args) => {
		await assertSlugAvailable(ctx, args.slug);
		const settings = await readGlobalSettings(ctx);
		const capacity = await readCapacityUsage(ctx, settings);
		if (!capacity.checkoutAvailable) {
			throw new ConvexError(
				capacityBlockMessage(capacity.blockReason) ??
					"New box checkout is temporarily unavailable."
			);
		}

		// A user reserving a slug removes it from everyone else's namespace and
		// commits one complete infrastructure package until checkout converts or
		// lapses. The per-user cap bounds how many a user holds at once; it is not a
		// limit on paid boxes, and reaching it does not block the sale. Nothing lets
		// a user cancel a reservation, and an abandoned one is exactly what the cap
		// exists to reclaim, so the oldest yields to the new one. Payment arriving
		// late on a released intent still converts or refunds, as when the TTL sweep
		// releases it.
		const cap = settings.maxActiveCheckoutIntentsPerUser;
		const active = await ctx.db
			.query("box_checkout_intents")
			.withIndex("user_id_status", (query) =>
				query.eq("user_id", args.userId).eq("status", "active")
			)
			.take(MAX_ACTIVE_CHECKOUT_INTENTS_PER_USER + 1);
		// Index order is oldest first, so these are the stalest reservations. A cap
		// lowered below the live count is enforced before the replacement is added.
		for (const stale of active.slice(
			0,
			reservationsToRelease(active.length, cap)
		)) {
			await releaseIntentDoc(ctx, stale, {
				reason: "superseded_by_new_reservation",
				status: "released"
			});
		}

		const timestamp = Date.now();
		const intentId = await ctx.db.insert("box_checkout_intents", {
			user_id: args.userId,
			slug: args.slug,
			status: "active",
			polar_checkout_expires_at: timestamp + CHECKOUT_RESERVATION_TTL_MS,
			created_at: timestamp,
			updated_at: timestamp
		});
		await reconcileCapacityAlert(ctx);
		return intentId;
	}
});

export const activeCheckoutIntentForUserSlug = internalQuery({
	args: {
		slug: v.string(),
		userId: v.string()
	},
	handler: async (ctx, args) => {
		const intent = await ctx.db
			.query("box_checkout_intents")
			.withIndex("user_id_slug_status", (query) =>
				query
					.eq("user_id", args.userId)
					.eq("slug", args.slug)
					.eq("status", "active")
			)
			.first();

		if (!intent?.polar_checkout_id || !intent.polar_checkout_url) return null;

		return {
			checkoutId: intent.polar_checkout_id,
			intentId: intent._id,
			checkoutUrl: intent.polar_checkout_url,
			slug: intent.slug
		};
	}
});

export const attachPolarCheckout = internalMutation({
	args: {
		checkoutId: v.string(),
		checkoutStatus: v.optional(v.string()),
		checkoutUrl: v.string(),
		expiresAt: v.number(),
		intentId: v.id("box_checkout_intents"),
		polarCustomerId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.intentId, {
			polar_checkout_id: args.checkoutId,
			polar_checkout_url: args.checkoutUrl,
			polar_checkout_status: args.checkoutStatus,
			polar_checkout_expires_at: args.expiresAt,
			polar_customer_id: args.polarCustomerId,
			updated_at: Date.now()
		});
	}
});

export const releaseCheckoutIntent = internalMutation({
	args: {
		intentId: v.id("box_checkout_intents"),
		polarCheckoutStatus: v.optional(v.string()),
		reason: v.string()
	},
	handler: async (ctx, args) => {
		const intent = await ctx.db.get(args.intentId);
		if (!intent || intent.status !== "active" || intent.box_id) return false;

		await releaseIntentDoc(ctx, intent, {
			polarCheckoutStatus: args.polarCheckoutStatus,
			reason: args.reason,
			status: "released"
		});
		await reconcileCapacityAlert(ctx);

		return true;
	}
});

export const releaseCheckoutIntentByPolarCheckout = internalMutation({
	args: {
		checkoutId: v.string(),
		polarCheckoutStatus: v.optional(v.string()),
		reason: v.string()
	},
	handler: async (ctx, args) => {
		const intent = await ctx.db
			.query("box_checkout_intents")
			.withIndex("polar_checkout_id", (query) =>
				query.eq("polar_checkout_id", args.checkoutId)
			)
			.first();

		if (!intent || intent.status !== "active" || intent.box_id) return false;

		await releaseIntentDoc(ctx, intent, {
			polarCheckoutStatus: args.polarCheckoutStatus,
			reason: args.reason,
			status: args.reason === "checkout_expired" ? "expired" : "released"
		});
		await reconcileCapacityAlert(ctx);

		return true;
	}
});

export const checkoutIntentIdByPolarCheckout = internalQuery({
	args: { checkoutId: v.string() },
	handler: async (ctx, args) => {
		const intent = await ctx.db
			.query("box_checkout_intents")
			.withIndex("polar_checkout_id", (query) =>
				query.eq("polar_checkout_id", args.checkoutId)
			)
			.first();

		return intent?._id ?? null;
	}
});

export const checkoutIntentIdFromString = internalQuery({
	args: { intentId: v.string() },
	handler: async (ctx, args) => {
		// Webhook metadata is untrusted text. Invalid ids resolve to null instead
		// of making Polar retry the webhook forever on a validation error.
		const intentId = ctx.db.normalizeId("box_checkout_intents", args.intentId);
		if (!intentId) return null;
		return (await ctx.db.get(intentId)) ? intentId : null;
	}
});

// Store the paid order before provisioning. It is the order refunded if the
// initial service cannot be delivered, while the versioned checkbox is the
// supplier-Terms acceptance evidence from Polar checkout.
export const recordInitialPaidOrder = internalMutation({
	args: {
		checkoutId: v.string(),
		customerId: v.string(),
		intentId: v.id("box_checkout_intents"),
		orderId: v.string(),
		subscriptionId: v.string(),
		termsAccepted: v.boolean(),
		termsAcceptedAt: v.number()
	},
	handler: async (ctx, args) => {
		const intent = await ctx.db.get(args.intentId);
		// Payment may legitimately arrive after the local/Polar expiry event. Keep
		// its billing evidence on any unconverted intent; conversion will atomically
		// reacquire capacity and the slug or refund it as unfulfilled.
		if (!intent) return "missing" as const;
		const recordingStatus = paidOrderRecordingStatus(intent, args);
		if (recordingStatus !== "recorded") return recordingStatus;
		if (!args.termsAccepted) {
			throw new ConvexError(
				"Paid Polar checkout is missing the required Terms field."
			);
		}
		const timestamp = Date.now();
		await ctx.db.patch(intent._id, {
			polar_checkout_id: intent.polar_checkout_id ?? args.checkoutId,
			polar_customer_id: args.customerId,
			polar_subscription_id: args.subscriptionId,
			polar_initial_order_id: intent.polar_initial_order_id ?? args.orderId,
			terms_accepted_at: intent.terms_accepted_at ?? args.termsAcceptedAt,
			terms_version: intent.terms_version ?? CLOUD_TERMS_VERSION,
			purge_at: billingRecordPurgeAt(timestamp),
			updated_at: timestamp
		});

		return "recorded" as const;
	}
});

export const paidOrderForBox = internalQuery({
	args: { boxId: v.id("boxes") },
	handler: async (ctx, args) => {
		const intent = await ctx.db
			.query("box_checkout_intents")
			.withIndex("box_id", (query) => query.eq("box_id", args.boxId))
			.first();
		if (!intent?.polar_initial_order_id || !intent.polar_subscription_id) {
			return null;
		}
		return {
			orderId: intent.polar_initial_order_id,
			subscriptionId: intent.polar_subscription_id
		};
	}
});

export const releaseExpiredCheckoutIntents = internalMutation({
	args: {},
	handler: async (ctx) => {
		const timestamp = Date.now();
		const expired = await ctx.db
			.query("box_checkout_intents")
			.withIndex("status_expires", (query) =>
				query
					.eq("status", "active")
					.gt("polar_checkout_expires_at", 0)
					.lte("polar_checkout_expires_at", timestamp)
			)
			.take(100);

		for (const intent of expired) {
			await releaseIntentDoc(ctx, intent, {
				reason: "checkout_expired_sweep",
				status: "expired"
			});
		}
		if (expired.length > 0) await reconcileCapacityAlert(ctx);

		return expired.length;
	}
});
