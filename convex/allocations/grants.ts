import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
	internalMutation,
	type MutationCtx,
	type QueryCtx,
} from "../_generated/server";

async function getUserGrant(ctx: QueryCtx, userId: Id<"users">) {
	return await ctx.db
		.query("serverGrants")
		.withIndex("by_user_id", (q) => q.eq("userId", userId))
		.unique();
}

/** Holds one unit of capacity. It stays held until the allocation's infrastructure is confirmed absent. */
export async function reserveServerGrant(
	ctx: MutationCtx,
	userId: Id<"users">,
) {
	const grant = await getUserGrant(ctx, userId);
	if (grant === null || grant.used >= grant.limit) {
		return null;
	}
	await ctx.db.patch("serverGrants", grant._id, { used: grant.used + 1 });
	return grant._id;
}

export async function releaseServerGrant(
	ctx: MutationCtx,
	grantId: Id<"serverGrants">,
) {
	const grant = await ctx.db.get("serverGrants", grantId);
	if (grant !== null) {
		await ctx.db.patch("serverGrants", grantId, {
			used: Math.max(0, grant.used - 1),
		});
	}
}

// Operator admission control. A lower limit prevents new allocations but does not delete existing servers.
export const set = internalMutation({
	args: { userId: v.id("users"), limit: v.number() },
	returns: v.null(),
	handler: async (ctx, { userId, limit }) => {
		if (!Number.isSafeInteger(limit) || limit < 0) {
			throw new ConvexError({
				message: "The server limit must be a nonnegative integer.",
			});
		}
		if ((await ctx.db.get("users", userId)) === null) {
			throw new ConvexError({ message: "The user does not exist." });
		}
		const grant = await getUserGrant(ctx, userId);
		if (grant === null) {
			await ctx.db.insert("serverGrants", { userId, limit, used: 0 });
		} else {
			await ctx.db.patch("serverGrants", grant._id, { limit });
		}
		return null;
	},
});
