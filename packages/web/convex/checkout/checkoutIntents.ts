import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { assertSlugAvailable } from "../boxes/slugAvailability";

// Polar checkout metadata keys. Set when creating a checkout and read back from
// the subscription webhook to reconnect a completed payment to the reserved
// intent.
export const CHECKOUT_INTENT_METADATA_KEYS = {
	intentId: "composery_checkout_intent_id",
	slug: "composery_box_slug",
	userId: "composery_clerk_user_id"
} as const;

export const CHECKOUT_RESERVATION_TTL_MS = 60 * 60 * 1000;

export const reserveCheckoutIntent = internalMutation({
	args: {
		runtimeAuthHash: v.string(),
		slug: v.string(),
		userId: v.string()
	},
	handler: async (ctx, args) => {
		await assertSlugAvailable(ctx, args.slug);

		const timestamp = Date.now();
		const intentId = await ctx.db.insert("box_checkout_intents", {
			user_id: args.userId,
			slug: args.slug,
			status: "active",
			runtime_auth_hash: args.runtimeAuthHash,
			polar_checkout_expires_at: timestamp + CHECKOUT_RESERVATION_TTL_MS,
			created_at: timestamp,
			updated_at: timestamp
		});

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

		if (!intent?.polar_checkout_url) return null;

		return {
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

		const timestamp = Date.now();
		await ctx.db.patch(intent._id, {
			status: "released",
			polar_checkout_status: args.polarCheckoutStatus,
			released_at: timestamp,
			release_reason: args.reason,
			updated_at: timestamp
		});

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

		const timestamp = Date.now();
		await ctx.db.patch(intent._id, {
			status: args.reason === "checkout_expired" ? "expired" : "released",
			polar_checkout_status: args.polarCheckoutStatus,
			released_at: timestamp,
			release_reason: args.reason,
			updated_at: timestamp
		});

		return true;
	}
});

export const checkoutIntentIdByPolarCheckout = internalQuery({
	args: {
		checkoutId: v.string()
	},
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
			await ctx.db.patch(intent._id, {
				status: "expired",
				released_at: timestamp,
				release_reason: "checkout_expired_sweep",
				updated_at: timestamp
			});
		}

		return expired.length;
	}
});
