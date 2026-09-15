import { type Infer, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalMutation,
	type MutationCtx,
	type QueryCtx,
} from "./_generated/server";
import { type Failure, fail } from "./errors";
import { quotaKind } from "./schema";

type QuotaKind = Infer<typeof quotaKind>;
type Quota = Doc<"userQuotas"> | Doc<"deploymentQuotas">;

async function getUserQuota(
	ctx: QueryCtx,
	userId: Id<"users">,
	kind: QuotaKind,
) {
	return await ctx.db
		.query("userQuotas")
		.withIndex("by_user_id_and_kind", (q) =>
			q.eq("userId", userId).eq("kind", kind),
		)
		.unique();
}

async function getDeploymentQuota(ctx: QueryCtx, kind: QuotaKind) {
	return await ctx.db
		.query("deploymentQuotas")
		.withIndex("by_kind", (q) => q.eq("kind", kind))
		.unique();
}

/** A missing quota has a limit of zero. */
function hasRoom<T extends Quota>(quota: T | null): quota is T {
	return quota !== null && quota.used < quota.limit;
}

function requireLimit(limit: number) {
	if (!Number.isSafeInteger(limit) || limit < 0) {
		throw new Error("A quota limit must be a nonnegative integer.");
	}
}

/** A server uses one unit of its owner's quota and of the deployment quota until its infrastructure is confirmed absent. */
export async function reserveServerQuota(
	ctx: MutationCtx,
	userId: Id<"users">,
): Promise<Failure | null> {
	const userQuota = await getUserQuota(ctx, userId, "server");
	if (!hasRoom(userQuota)) {
		return fail("server_quota_reached");
	}
	const deploymentQuota = await getDeploymentQuota(ctx, "server");
	if (!hasRoom(deploymentQuota)) {
		return fail("server_capacity_unavailable");
	}
	await ctx.db.patch("userQuotas", userQuota._id, { used: userQuota.used + 1 });
	await ctx.db.patch("deploymentQuotas", deploymentQuota._id, {
		used: deploymentQuota.used + 1,
	});
	return null;
}

export async function transferServerQuota(
	ctx: MutationCtx,
	fromUserId: Id<"users">,
	toUserId: Id<"users">,
): Promise<Failure | null> {
	const toQuota = await getUserQuota(ctx, toUserId, "server");
	if (!hasRoom(toQuota)) {
		return fail("server_quota_reached");
	}
	await ctx.db.patch("userQuotas", toQuota._id, { used: toQuota.used + 1 });
	await releaseUserQuota(ctx, fromUserId, "server");
	return null;
}

async function releaseUserQuota(
	ctx: MutationCtx,
	userId: Id<"users">,
	kind: QuotaKind,
) {
	const quota = await getUserQuota(ctx, userId, kind);
	if (quota !== null) {
		await ctx.db.patch("userQuotas", quota._id, {
			used: Math.max(0, quota.used - 1),
		});
	}
}

export async function releaseServerQuota(
	ctx: MutationCtx,
	ownerId: Id<"users">,
) {
	await releaseUserQuota(ctx, ownerId, "server");
	const deploymentQuota = await getDeploymentQuota(ctx, "server");
	if (deploymentQuota !== null) {
		await ctx.db.patch("deploymentQuotas", deploymentQuota._id, {
			used: Math.max(0, deploymentQuota.used - 1),
		});
	}
}

export async function deleteUserQuotas(ctx: MutationCtx, userId: Id<"users">) {
	const quotas = await ctx.db
		.query("userQuotas")
		.withIndex("by_user_id_and_kind", (q) => q.eq("userId", userId))
		.collect();
	for (const quota of quotas) {
		await ctx.db.delete("userQuotas", quota._id);
	}
}

/** A lower limit prevents new servers and does not delete existing ones. */
export const setForUser = internalMutation({
	args: { userId: v.id("users"), kind: quotaKind, limit: v.number() },
	returns: v.null(),
	handler: async (ctx, { userId, kind, limit }) => {
		requireLimit(limit);
		if ((await ctx.db.get("users", userId)) === null) {
			throw new Error("The user does not exist.");
		}
		const quota = await getUserQuota(ctx, userId, kind);
		if (quota === null) {
			await ctx.db.insert("userQuotas", { userId, kind, limit, used: 0 });
		} else {
			await ctx.db.patch("userQuotas", quota._id, { limit });
		}
		return null;
	},
});

export const setForDeployment = internalMutation({
	args: { kind: quotaKind, limit: v.number() },
	returns: v.null(),
	handler: async (ctx, { kind, limit }) => {
		requireLimit(limit);
		const quota = await getDeploymentQuota(ctx, kind);
		if (quota === null) {
			await ctx.db.insert("deploymentQuotas", { kind, limit, used: 0 });
		} else {
			await ctx.db.patch("deploymentQuotas", quota._id, { limit });
		}
		return null;
	},
});
