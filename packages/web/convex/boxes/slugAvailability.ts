import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import { isValidSlug } from "../../lib/boxes/slug";
import { boxStatusesExcept } from "../schema";

type ReadCtx = { db: DatabaseReader };

// "deleted" is the only status excluded, so a slug frees up once its box is
// gone but stays reserved through every active, failed, or suspended state.
export const SLUG_OCCUPYING_STATUSES: readonly Doc<"boxes">["status"][] =
	boxStatusesExcept("deleted");

async function activeBoxWithSlug(
	ctx: ReadCtx,
	slug: string,
	ignoreBoxId?: Id<"boxes">
) {
	for (const status of SLUG_OCCUPYING_STATUSES) {
		const matches = await ctx.db
			.query("boxes")
			.withIndex("slug_status", (query) =>
				query.eq("slug", slug).eq("status", status)
			)
			.take(2);
		const match = matches.find((box) => box._id !== ignoreBoxId);
		if (match) return match;
	}

	return null;
}

async function activeIntentWithSlug(
	ctx: ReadCtx,
	slug: string,
	ignoreIntentId?: Id<"box_checkout_intents">
) {
	const intent = await ctx.db
		.query("box_checkout_intents")
		.withIndex("slug_status", (query) =>
			query.eq("slug", slug).eq("status", "active")
		)
		.first();

	return intent && intent._id !== ignoreIntentId ? intent : null;
}

async function activeSlugOperation(ctx: ReadCtx, slug: string) {
	const pending = await ctx.db
		.query("box_operations")
		.withIndex("reserved_slug_status", (query) =>
			query.eq("reserved_slug", slug).eq("status", "pending")
		)
		.first();

	if (pending) return pending;

	return await ctx.db
		.query("box_operations")
		.withIndex("reserved_slug_status", (query) =>
			query.eq("reserved_slug", slug).eq("status", "running")
		)
		.first();
}

// What already holds this slug that the caller is allowed to be. One shape for
// both readers, because "is it free" and "insist it is free" must never disagree
// about who is asking - a caller that could name the box it is renaming but not
// the reservation it is resuming would refuse that caller their own slug.
export type SlugHolder = {
	boxId?: Id<"boxes">;
	intentId?: Id<"box_checkout_intents">;
};

export async function isSlugAvailable(
	ctx: ReadCtx,
	slug: string,
	ignore?: SlugHolder
): Promise<boolean> {
	if (!isValidSlug(slug)) return false;
	if (await activeBoxWithSlug(ctx, slug, ignore?.boxId)) return false;
	if (await activeIntentWithSlug(ctx, slug, ignore?.intentId)) return false;
	if (await activeSlugOperation(ctx, slug)) return false;
	return true;
}

export async function assertSlugAvailable(
	ctx: ReadCtx,
	slug: string,
	ignore?: SlugHolder
) {
	if (!(await isSlugAvailable(ctx, slug, ignore))) {
		throw new ConvexError("Slug is unavailable.");
	}
}
