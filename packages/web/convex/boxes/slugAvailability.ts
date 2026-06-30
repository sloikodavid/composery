import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import { isValidSlug } from "../../lib/box-slug";

type ReadCtx = { db: DatabaseReader };

// "deleted" is the only status excluded, so a slug frees up once its box is
// gone but stays reserved through every active, failed, or suspended state.
const SLUG_OCCUPYING_STATUSES: readonly Doc<"boxes">["status"][] = [
	"provisioning",
	"running",
	"provisioning_failed",
	"stopping",
	"stopped",
	"starting",
	"resetting",
	"reset_failed",
	"restoring",
	"restore_failed",
	"suspending",
	"suspended",
	"unsuspending",
	"deleting",
	"delete_failed"
];

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

export async function isSlugAvailable(
	ctx: ReadCtx,
	slug: string,
	ignore?: {
		boxId?: Id<"boxes">;
		intentId?: Id<"box_checkout_intents">;
	}
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
	ignoreBoxId?: Id<"boxes">,
	ignoreIntentId?: Id<"box_checkout_intents">
) {
	const available = await isSlugAvailable(ctx, slug, {
		boxId: ignoreBoxId,
		intentId: ignoreIntentId
	});
	if (!available) {
		throw new ConvexError("Slug is unavailable.");
	}
}
