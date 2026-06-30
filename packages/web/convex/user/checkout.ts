import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, query } from "../_generated/server";
import { emailFromIdentity } from "../authorization";
import { polarServer } from "../billing/polar";
import { hashBoxPassword } from "../boxes/boxPassword";
import { isSlugAvailable } from "../boxes/slugAvailability";
import { CHECKOUT_INTENT_METADATA_KEYS } from "../checkout/checkoutIntents";
import { requiredEnv, websiteOrigin } from "../env";
import { isValidSlug, sanitizeSlug } from "../../lib/box-slug";

type CheckoutResult = {
	checkoutUrl: string;
	intentId: Id<"box_checkout_intents">;
	slug: string;
};

export const slugAvailability = query({
	args: {
		slug: v.string()
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return { available: false };

		const slug = sanitizeSlug(args.slug);
		return { available: await isSlugAvailable(ctx, slug), slug };
	}
});

export const createCheckout = action({
	args: {
		password: v.string(),
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

		const checkoutEnabled = await ctx.runQuery(
			internal.settings.readCheckoutEnabled,
			{}
		);
		if (!checkoutEnabled) {
			throw new ConvexError("New box checkout is temporarily disabled.");
		}

		const slug = sanitizeSlug(args.slug);
		if (!isValidSlug(slug)) {
			throw new ConvexError("Slug is unavailable.");
		}

		const activeCheckout: CheckoutResult | null = await ctx.runQuery(
			internal.checkout.checkoutIntents.activeCheckoutIntentForUserSlug,
			{
				userId: identity.subject,
				slug
			}
		);

		if (activeCheckout) {
			return {
				checkoutUrl: activeCheckout.checkoutUrl,
				intentId: activeCheckout.intentId,
				slug: activeCheckout.slug
			};
		}

		const runtimeAuthHash = await hashBoxPassword(args.password);
		let intentId: Id<"box_checkout_intents"> | undefined;

		try {
			const reservedIntentId: Id<"box_checkout_intents"> =
				await ctx.runMutation(
					internal.checkout.checkoutIntents.reserveCheckoutIntent,
					{
						userId: identity.subject,
						slug,
						runtimeAuthHash
					}
				);
			intentId = reservedIntentId;

			const origin = websiteOrigin();
			const checkout = await polarServer().createCheckoutSession(ctx, {
				userId: identity.subject,
				email: user.email,
				productIds: [requiredEnv("POLAR_BOX_PRODUCT_ID")],
				origin,
				successUrl: `${origin}/boxes/${slug}?checkout_id={CHECKOUT_ID}`,
				metadata: {
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
