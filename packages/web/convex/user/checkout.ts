import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, query } from "../_generated/server";
import { emailFromIdentity } from "../authorization";
import {
	boxProductId,
	boxProductIds,
	polarServer,
	selectPolarCheckoutProduct
} from "../billing/polar";
import { isSlugAvailable } from "../boxes/slugAvailability";
import { CHECKOUT_INTENT_METADATA_KEYS } from "../checkout/checkoutIntents";
import { websiteOrigin } from "../env";
import { isValidSlug, sanitizeSlug } from "../../lib/box-slug";
import { capacityBlockMessage, readCapacityUsage } from "../boxes/capacity";
import { readGlobalSettings } from "../settings";
import { vBoxPlan } from "../schema";

type CheckoutResult = {
	checkoutUrl: string;
	intentId: Id<"box_checkout_intents">;
	slug: string;
};

type ActiveCheckoutResult = CheckoutResult & { checkoutId: string };

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

export const completedCheckout = query({
	args: { checkoutId: v.string() },
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
		return { boxId: intent.box_id ?? null, status: intent.status };
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

		const user = await ctx.runMutation(internal.users.ensureUserForIdentity, {
			clerkUserId: identity.subject,
			email: emailFromIdentity(identity)
		});
		if (user.suspended) throw new ConvexError("User is suspended.");
		if (user.deletion_pending) {
			throw new ConvexError("Account deletion is already in progress.");
		}

		const slug = sanitizeSlug(args.slug);
		if (!isValidSlug(slug)) {
			throw new ConvexError("Slug is unavailable.");
		}

		const activeCheckout: ActiveCheckoutResult | null = await ctx.runQuery(
			internal.checkout.checkoutIntents.activeCheckoutIntentForUserSlug,
			{
				userId: identity.subject,
				slug
			}
		);

		if (activeCheckout) {
			// The reservation is per slug, not per plan, so a visitor who reopened
			// checkout on the other card gets the same reservation with the other
			// plan's product selected, and the row's own plan follows above. The box
			// is then born on whichever plan the order was actually paid against.
			await ctx.runMutation(
				internal.checkout.checkoutIntents.setCheckoutIntentPlan,
				{ intentId: activeCheckout.intentId, plan: args.plan }
			);
			await selectPolarCheckoutProduct(
				activeCheckout.checkoutId,
				boxProductId({ billingInterval: args.billingInterval, plan: args.plan })
			);
			return {
				checkoutUrl: activeCheckout.checkoutUrl,
				intentId: activeCheckout.intentId,
				slug: activeCheckout.slug
			};
		}

		let intentId: Id<"box_checkout_intents"> | undefined;

		try {
			const reservedIntentId: Id<"box_checkout_intents"> =
				await ctx.runMutation(
					internal.checkout.checkoutIntents.reserveCheckoutIntent,
					{
						plan: args.plan,
						userId: identity.subject,
						slug
					}
				);
			intentId = reservedIntentId;

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
					[CHECKOUT_INTENT_METADATA_KEYS.intentId]: reservedIntentId,
					[CHECKOUT_INTENT_METADATA_KEYS.slug]: slug,
					[CHECKOUT_INTENT_METADATA_KEYS.userId]: identity.subject
				}
			});

			await ctx.runMutation(
				internal.checkout.checkoutIntents.attachPolarCheckout,
				{
					intentId: reservedIntentId,
					checkoutId: checkout.id,
					checkoutUrl: checkout.url,
					checkoutStatus: checkout.status,
					expiresAt: checkout.expiresAt.getTime(),
					polarCustomerId: checkout.customerId ?? undefined
				}
			);

			return {
				checkoutUrl: checkout.url,
				intentId,
				slug
			};
		} catch (error) {
			if (intentId) {
				await ctx.runMutation(
					internal.checkout.checkoutIntents.releaseCheckoutIntent,
					{
						intentId,
						reason: "polar_checkout_creation_failed"
					}
				);
			}
			throw error;
		}
	}
});
