import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { sanitizeSlug } from "../../lib/box-slug";

// Resolve a (sanitized) slug to its box for query and mutation handlers. The
// owner and staff read paths all start here instead of repeating the index scan.
export async function findBoxBySlug(ctx: QueryCtx, slug: string) {
	return await ctx.db
		.query("boxes")
		.withIndex("slug", (query) => query.eq("slug", sanitizeSlug(slug)))
		.first();
}

export const vSubscriptionReconciliationStatus = v.union(
	v.literal("provisioning"),
	v.literal("running"),
	v.literal("provisioning_failed"),
	v.literal("stopping"),
	v.literal("stopped"),
	v.literal("starting"),
	v.literal("resetting"),
	v.literal("reset_failed"),
	v.literal("restoring"),
	v.literal("restore_failed"),
	v.literal("suspending"),
	v.literal("suspended"),
	v.literal("unsuspending"),
	v.literal("delete_failed")
);

export const SUBSCRIPTION_RECONCILIATION_STATUSES =
	vSubscriptionReconciliationStatus.members.map((member) => member.value);

const SUBSCRIPTION_RECONCILIATION_PAGE_SIZE = 200;
const USER_SUSPENSION_BOX_PAGE_SIZE = 100;

// The reason recorded on a box's most recent suspend operation (box-level
// suspension keeps it in the operation metadata, not on the box row). Shared by
// the owner and staff box-detail queries.
export async function latestSuspensionReason(
	ctx: QueryCtx,
	boxId: Id<"boxes">
) {
	const operations = await ctx.db
		.query("box_operations")
		.withIndex("box_id_type_created_at", (builder) =>
			builder.eq("box_id", boxId).eq("type", "suspend")
		)
		.order("desc")
		.first();
	if (!operations) return null;

	const reason = operations.metadata?.reason;
	return typeof reason === "string" && reason.trim() ? reason : null;
}

export const boxIdBySubscription = internalQuery({
	args: {
		subscriptionId: v.string()
	},
	handler: async (ctx, args) => {
		const box = await ctx.db
			.query("boxes")
			.withIndex("polar_subscription_id", (query) =>
				query.eq("polar_subscription_id", args.subscriptionId)
			)
			.first();

		if (!box || box.status === "deleted") return null;
		return box._id;
	}
});

export const boxBySlug = internalQuery({
	args: {
		slug: v.string()
	},
	handler: async (ctx, args) => {
		return await ctx.db
			.query("boxes")
			.withIndex("slug", (query) => query.eq("slug", args.slug))
			.first();
	}
});

export const boxByOwnerSlug = internalQuery({
	args: {
		slug: v.string(),
		userId: v.string()
	},
	handler: async (ctx, args) => {
		const box = await ctx.db
			.query("boxes")
			.withIndex("slug", (query) => query.eq("slug", args.slug))
			.first();

		if (!box || box.user_id !== args.userId) return null;
		return box;
	}
});

export const getBoxLifecycleSnapshot = internalQuery({
	args: {
		boxId: v.id("boxes")
	},
	handler: async (ctx, args) => {
		const box = await ctx.db.get(args.boxId);
		if (!box) throw new Error("Box not found.");
		return box;
	}
});

export const boxesForUserStatusPage = internalQuery({
	args: {
		clerkUserId: v.string(),
		cursor: v.union(v.string(), v.null()),
		status: v.union(v.literal("running"), v.literal("suspended"))
	},
	handler: async (ctx, args) => {
		return await ctx.db
			.query("boxes")
			.withIndex("user_id_status", (query) =>
				query.eq("user_id", args.clerkUserId).eq("status", args.status)
			)
			.paginate({
				cursor: args.cursor,
				numItems: USER_SUSPENSION_BOX_PAGE_SIZE
			});
	}
});

export const boxesForSubscriptionReconciliationPage = internalQuery({
	args: {
		cursor: v.union(v.string(), v.null()),
		status: vSubscriptionReconciliationStatus
	},
	handler: async (ctx, args) => {
		return await ctx.db
			.query("boxes")
			.withIndex("status", (query) => query.eq("status", args.status))
			.paginate({
				cursor: args.cursor,
				numItems: SUBSCRIPTION_RECONCILIATION_PAGE_SIZE
			});
	}
});
