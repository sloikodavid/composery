import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { internalMutation } from "../functions";
import { getServerQuota, requireServerQuotaCount } from "./quota_usage";

export const set = internalMutation({
	args: { userId: v.optional(v.id("users")), limit: v.number() },
	returns: v.null(),
	handler: async (ctx, { userId, limit }) => {
		requireServerQuotaCount(limit);
		if (userId !== undefined && (await ctx.db.get("users", userId)) === null) {
			throw new Error("The user does not exist.");
		}
		const quota = await getServerQuota(ctx, userId);
		if (quota === null) {
			await ctx.db.insert("serverQuotas", {
				...(userId === undefined ? {} : { userId }),
				limit,
				used: 0,
			});
		} else {
			await ctx.db.patch("serverQuotas", quota._id, { limit });
		}
		return null;
	},
});

export const get = internalQuery({
	args: { userId: v.optional(v.id("users")) },
	returns: v.object({ limit: v.number(), used: v.number() }),
	handler: async (ctx, { userId }) => {
		const quota = await getServerQuota(ctx, userId);
		return { limit: quota?.limit ?? 0, used: quota?.used ?? 0 };
	},
});
