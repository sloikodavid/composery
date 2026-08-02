import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, query } from "../_generated/server";
import { accountBlock, emailFromIdentity } from "../users";
import {
	boxProductId,
	boxProductIds,
	polarServer,
	selectPolarCheckoutProduct
} from "../billing/polar";
import { isSlugAvailable } from "../boxes/slugAvailability";
import { CHECKOUT_INTENT_METADATA_KEYS } from "../checkout/checkoutIntents";
import { websiteOrigin } from "../env";
import { isValidSlug, sanitizeSlug } from "../model/box/slug";
import { capacityBlockMessage, readCapacityUsage } from "../boxes/capacity";
import { readGlobalSettings } from "../settings";
import { vBoxPlan } from "../schema";

type CheckoutResult = {
	checkoutUrl: string;
	intentId: Id<"box_checkout_intents">;
	slug: string;
};

// What `reserveCheckoutIntent` hands back. Named here because an action calling
// its own deployment's mutation has no inferred return type to lean on.
type Reservation = {
	checkout: { checkoutId: string; checkoutUrl: string } | null;
	intentId: Id<"box_checkout_intents">;
};

export const slugAvailability = query({
	args: {
		slug: v.string()
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		const slug = sanitizeSlug(args.slug);
		if (!identity) {
			return {
				available: await isSlugAvailable(ctx, slug),
				resumable: false,
				slug
			};
		}

		// The caller's own active reservation isn't "taken" from their point of
		// view - createCheckout reuses it. Ignore it here so a returning user can
		// resume their checkout, and so pressing "Continue to checkout" (which
		// creates the reservation) doesn't flip the slug to unavailable mid-flow.
		const ownIntent = await ctx.db
			.query("box_checkout_intents")
			.withIndex("user_id_slug_status", (query) =>
				query
					.eq("user_id", identity.subject)
					.eq("slug", slug)
					.eq("status", "active")
			)
			.first();

		return {
			available: await isSlugAvailable(ctx, slug, {
				intentId: ownIntent?._id
			}),
			resumable: Boolean(ownIntent?.polar_checkout_url),
			slug
		};
	}
});

// Where the customer landing back from Polar is sent, and what to tell them if
// they are not being sent anywhere.
//
// "refunded" is the case worth having a name for: they paid, and fulfillment
// refused the sale - no capacity, the slug taken, Terms missing - so the
// subscription was revoked and the order refunded. Without it they would arrive
// at an empty box list after a successful payment and be told nothing at all,
// which is the same silence the webhook side no longer allows itself.
export const completedCheckout = query({
	args: { checkoutId: v.string() },
	returns: v.union(
		v.null(),
		v.object({
			boxId: v.union(v.id("boxes"), v.null()),
			outcome: v.union(
				v.literal("pending"),
				v.literal("provisioned"),
				v.literal("refunded")
			)
		})
	),
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const intent = await ctx.db
			.query("box_checkout_intents")
			.withIndex("polar_checkout_id", (query) =>
				query.eq("polar_checkout_id", args.checkoutId)
			)
			.first();
		if (!intent || intent.user_id !== identity.subject) return null;

		if (intent.box_id) {
			return { boxId: intent.box_id, outcome: "provisioned" as const };
		}
		// Paid, because Polar told us the order id, and still without a box. A
		// reservation that simply lapsed unpaid has no order on it and is only
		// "pending" - the customer may still be finishing checkout in the other tab.
		const refunded =
			Boolean(intent.polar_initial_order_id) && intent.status !== "active";
		return {
			boxId: null,
			outcome: refunded ? ("refunded" as const) : ("pending" as const)
		};
	}
});

export const availability = query({
	args: {},
	handler: async (ctx) => {
		const settings = await readGlobalSettings(ctx);
		const capacity = await readCapacityUsage(ctx, settings);
		return {
			available: capacity.checkoutAvailable,
			message: capacityBlockMessage(capacity.blockReason)
		};
	}
});

export const createCheckout = action({
	args: {
		billingInterval: v.union(v.literal("month"), v.literal("year")),
		plan: vBoxPlan,
		slug: v.string()
	},
	returns: v.object({
		checkoutUrl: v.string(),
		intentId: v.id("box_checkout_intents"),
		slug: v.string()
	}),
	handler: async (ctx, args): Promise<CheckoutResult> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new ConvexError("Authentication required.");

		// The row has to exist before the sale, and this is an action, so it is
		// created through a mutation rather than by `requireActiveUser`. The gate
		// afterwards is the same one every other owner-facing entry point applies.
		const user = await ctx.runMutation(internal.users.ensureUserForIdentity, {
			clerkUserId: identity.subject,
			email: emailFromIdentity(identity)
		});
		const blocked = accountBlock(user);
		if (blocked) throw new ConvexError(blocked);

		const slug = sanitizeSlug(args.slug);
		if (!isValidSlug(slug)) {
			throw new ConvexError("Slug is unavailable.");
		}

		// Reserving and resuming are one answer, so this action never has to decide
		// which of the two it is in - see `reserveCheckoutIntent`.
		const reserved: Reservation = await ctx.runMutation(
			internal.checkout.checkoutIntents.reserveCheckoutIntent,
			{
				plan: args.plan,
				userId: identity.subject,
				slug
			}
		);

		if (reserved.checkout) {
			// A visitor who reopened checkout on the other card gets the same
			// reservation with the other plan's product selected, and the row's own
			// plan followed above. The box is then born on whichever plan the order
			// was actually paid against.
			await selectPolarCheckoutProduct(
				reserved.checkout.checkoutId,
				boxProductId({ billingInterval: args.billingInterval, plan: args.plan })
			);
			return {
				checkoutUrl: reserved.checkout.checkoutUrl,
				intentId: reserved.intentId,
				slug
			};
		}

		try {
			const origin = websiteOrigin();
			const checkout = await polarServer().createCheckoutSession(ctx, {
				userId: identity.subject,
				email: user.email,
				// Polar models monthly and yearly billing as separate products, so a
				// plan sold on two intervals is two products. Both of the chosen
				// plan's are available in checkout, the selected one first; the other
				// plan's are not, so the sale cannot change plan behind the
				// reservation that admitted it.
				productIds: boxProductIds({
					billingInterval: args.billingInterval,
					plan: args.plan
				}),
				origin,
				successUrl: `${origin}/boxes?checkout_id={CHECKOUT_ID}`,
				metadata: {
					[CHECKOUT_INTENT_METADATA_KEYS.selectedBillingInterval]:
						args.billingInterval,
					[CHECKOUT_INTENT_METADATA_KEYS.selectedPlan]: args.plan,
					[CHECKOUT_INTENT_METADATA_KEYS.intentId]: reserved.intentId,
					[CHECKOUT_INTENT_METADATA_KEYS.slug]: slug,
					[CHECKOUT_INTENT_METADATA_KEYS.userId]: identity.subject
				}
			});

			await ctx.runMutation(
				internal.checkout.checkoutIntents.attachPolarCheckout,
				{
					intentId: reserved.intentId,
					checkoutId: checkout.id,
					checkoutUrl: checkout.url,
					checkoutStatus: checkout.status,
					expiresAt: checkout.expiresAt.getTime(),
					polarCustomerId: checkout.customerId ?? undefined
				}
			);

			return {
				checkoutUrl: checkout.url,
				intentId: reserved.intentId,
				slug
			};
		} catch (error) {
			// Only a reservation this call made is given back. A resumed one belongs
			// to a checkout that already exists and returned above.
			await ctx.runMutation(
				internal.checkout.checkoutIntents.releaseCheckoutIntent,
				{
					intentId: reserved.intentId,
					reason: "polar_checkout_creation_failed"
				}
			);
			throw error;
		}
	}
});
