import type { Change } from "convex-helpers/server/triggers";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { type Failure, fail, toConvexError } from "../errors";

export function requireServerQuotaCount(count: number) {
	if (!Number.isSafeInteger(count) || count < 0) {
		throw new Error("A server quota count must be a nonnegative safe integer.");
	}
}

export function getServerQuota(ctx: QueryCtx, userId?: Id<"users">) {
	return ctx.db
		.query("serverQuotas")
		.withIndex("by_user_id", (q) => q.eq("userId", userId))
		.unique();
}

function hasRoom(quota: Doc<"serverQuotas"> | null) {
	if (quota === null) {
		return false;
	}
	requireServerQuotaCount(quota.limit);
	requireServerQuotaCount(quota.used);
	return quota.used < quota.limit;
}

/** A read-only check lets creation return its normal failure result before any write. */
export async function getServerQuotaFailure(
	ctx: QueryCtx,
	userId: Id<"users">,
): Promise<Failure | null> {
	if (!hasRoom(await getServerQuota(ctx, userId))) {
		return fail("server_quota_reached");
	}
	return hasRoom(await getServerQuota(ctx))
		? null
		: fail("server_capacity_unavailable");
}

async function changeQuotaUsage(
	ctx: MutationCtx,
	userId: Id<"users"> | undefined,
	change: 1 | -1,
) {
	const quota = await getServerQuota(ctx, userId);
	if (change > 0 && !hasRoom(quota)) {
		throw toConvexError(
			userId === undefined
				? "server_capacity_unavailable"
				: "server_quota_reached",
		);
	}
	if (quota === null) {
		// A deleted user's quota is gone while provider cleanup can still be pending.
		if (userId !== undefined && (await ctx.db.get("users", userId)) === null) {
			return;
		}
		throw new Error("The server quota is missing.");
	}
	const used = quota.used + change;
	requireServerQuotaCount(used);
	await ctx.db.patch("serverQuotas", quota._id, { used });
}

/** Server writes own accounting; callers cannot omit a count update or transfer. */
export async function updateServerQuotaUsage(
	ctx: MutationCtx,
	change: Change<DataModel, "servers">,
) {
	switch (change.operation) {
		case "insert":
			await changeQuotaUsage(ctx, change.newDoc.ownerId, 1);
			await changeQuotaUsage(ctx, undefined, 1);
			return;
		case "update":
			if (change.oldDoc.ownerId !== change.newDoc.ownerId) {
				await changeQuotaUsage(ctx, change.newDoc.ownerId, 1);
				await changeQuotaUsage(ctx, change.oldDoc.ownerId, -1);
			}
			return;
		case "delete":
			await changeQuotaUsage(ctx, change.oldDoc.ownerId, -1);
			await changeQuotaUsage(ctx, undefined, -1);
	}
}

export async function deleteUserServerQuota(
	ctx: MutationCtx,
	change: Change<DataModel, "users">,
) {
	switch (change.operation) {
		case "insert":
		case "update":
			return;
		case "delete": {
			const quota = await getServerQuota(ctx, change.id);
			if (quota !== null) {
				await ctx.db.delete("serverQuotas", quota._id);
			}
		}
	}
}
