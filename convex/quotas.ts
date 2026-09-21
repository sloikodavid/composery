import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	type ActionCtx,
	internalAction,
	internalMutation,
	internalQuery,
	type MutationCtx,
	type QueryCtx,
} from "./_generated/server";
import { type Failure, fail } from "./errors";
import { quotaKind } from "./schema";

type QuotaKind = Infer<typeof quotaKind>;
type Quota = Doc<"quotas">;
/** Who a quota belongs to: one user, or the deployment as a whole. */
type QuotaHolder = Id<"users"> | "deployment";

const recountPageSize = 100;
const recountMaxPages = 100;
const recountAttempts = 3;

function toUserId(holder: QuotaHolder) {
	return holder === "deployment" ? undefined : holder;
}

async function getQuota(ctx: QueryCtx, kind: QuotaKind, holder: QuotaHolder) {
	return await ctx.db
		.query("quotas")
		.withIndex("by_user_id_and_kind", (q) =>
			q.eq("userId", toUserId(holder)).eq("kind", kind),
		)
		.unique();
}

function requireCount(count: number, what: string) {
	if (!Number.isSafeInteger(count) || count < 0) {
		throw new Error(`A quota ${what} must be a nonnegative integer.`);
	}
}

function requireQuotaValues(quota: Quota) {
	requireCount(quota.limit, "limit");
	requireCount(quota.used, "usage");
}

/** Missing quota has no capacity. */
function hasRoom(quota: Quota | null): quota is Quota {
	if (quota === null) {
		return false;
	}
	requireQuotaValues(quota);
	return quota.used < quota.limit;
}

async function updateQuotaUsage(
	ctx: MutationCtx,
	quota: Quota,
	change: 1 | -1,
) {
	const used = quota.used + change;
	if (used < 0) {
		throw new Error("A quota was released with no usage.");
	}
	await ctx.db.patch("quotas", quota._id, { used });
}

/** A user deleted while holding leaves no quota row for the release to reach. */
async function releaseUserQuota(
	ctx: MutationCtx,
	kind: QuotaKind,
	userId: Id<"users">,
) {
	const quota = await getQuota(ctx, kind, userId);
	if (quota !== null) {
		requireQuotaValues(quota);
		await updateQuotaUsage(ctx, quota, -1);
	}
}

/** Reserve until provider infrastructure is confirmed absent. */
export async function reserveServerQuota(
	ctx: MutationCtx,
	userId: Id<"users">,
): Promise<Failure | null> {
	const user = await getQuota(ctx, "server", userId);
	if (!hasRoom(user)) {
		return fail("server_quota_reached");
	}
	const deployment = await getQuota(ctx, "server", "deployment");
	if (!hasRoom(deployment)) {
		return fail("server_capacity_unavailable");
	}
	await updateQuotaUsage(ctx, user, 1);
	await updateQuotaUsage(ctx, deployment, 1);
	return null;
}

export async function transferServerQuota(
	ctx: MutationCtx,
	ownerId: Id<"users">,
	nextOwnerId: Id<"users">,
): Promise<Failure | null> {
	// Take the room before giving any back, so a full recipient refuses the transfer.
	const next = await getQuota(ctx, "server", nextOwnerId);
	if (!hasRoom(next)) {
		return fail("server_quota_reached");
	}
	await updateQuotaUsage(ctx, next, 1);
	await releaseUserQuota(ctx, "server", ownerId);
	return null;
}

export async function releaseServerQuota(
	ctx: MutationCtx,
	ownerId: Id<"users">,
) {
	await releaseUserQuota(ctx, "server", ownerId);
	// The deployment holds every server, so its quota must outlive any owner's.
	const deployment = await getQuota(ctx, "server", "deployment");
	if (deployment === null) {
		throw new Error("The deployment server quota is missing.");
	}
	requireQuotaValues(deployment);
	await updateQuotaUsage(ctx, deployment, -1);
}

export async function deleteUserQuotas(ctx: MutationCtx, userId: Id<"users">) {
	// One row per kind, so a whole user's quotas fit in one read.
	const quotas = await ctx.db
		.query("quotas")
		.withIndex("by_user_id_and_kind", (q) => q.eq("userId", userId))
		.collect();
	for (const quota of quotas) {
		await ctx.db.delete("quotas", quota._id);
	}
}

async function getQuotaEpoch(ctx: QueryCtx, kind: QuotaKind) {
	const row = await ctx.db
		.query("quotaEpochs")
		.withIndex("by_kind", (q) => q.eq("kind", kind))
		.unique();
	return row?.epoch ?? 0;
}

/** Advance the fence whenever a held row or its owner changes. */
export async function bumpQuotaEpoch(ctx: MutationCtx, kind: QuotaKind) {
	const row = await ctx.db
		.query("quotaEpochs")
		.withIndex("by_kind", (q) => q.eq("kind", kind))
		.unique();
	if (row === null) {
		await ctx.db.insert("quotaEpochs", { kind, epoch: 1 });
		return;
	}
	requireCount(row.epoch, "epoch");
	if (row.epoch === Number.MAX_SAFE_INTEGER) {
		throw new Error("The quota epoch is exhausted.");
	}
	await ctx.db.patch("quotaEpochs", row._id, { epoch: row.epoch + 1 });
}

type HeldPage = {
	used: number;
	isDone: boolean;
	continueCursor: string;
	epoch: number;
};

/** One page of what a holder already holds of a kind; the only place a kind names its rows. */
function listHeld(
	ctx: QueryCtx,
	kind: QuotaKind,
	holder: QuotaHolder,
	options: Readonly<{
		numItems: number;
		maximumRowsRead: number;
		cursor: string | null;
	}>,
) {
	switch (kind) {
		case "server": {
			const userId = toUserId(holder);
			// Server and allocation rows are created and removed in the same transaction.
			return userId === undefined
				? ctx.db.query("serverAllocations").paginate(options)
				: ctx.db
						.query("servers")
						.withIndex("by_owner_id", (q) => q.eq("ownerId", userId))
						.paginate(options);
		}
	}
}

export const readHeldPage = internalQuery({
	args: {
		kind: quotaKind,
		cursor: v.union(v.string(), v.null()),
		userId: v.optional(v.id("users")),
	},
	returns: v.object({
		used: v.number(),
		isDone: v.boolean(),
		continueCursor: v.string(),
		epoch: v.number(),
	}),
	handler: async (ctx, { kind, cursor, userId }) => {
		const result = await listHeld(ctx, kind, userId ?? "deployment", {
			numItems: recountPageSize,
			maximumRowsRead: recountPageSize,
			cursor,
		});
		return {
			used: result.page.length,
			isDone: result.isDone,
			continueCursor: result.continueCursor,
			epoch: await getQuotaEpoch(ctx, kind),
		};
	},
});

export const applyReconciliation = internalMutation({
	args: {
		kind: quotaKind,
		userId: v.optional(v.id("users")),
		limit: v.number(),
		used: v.number(),
		epoch: v.number(),
	},
	returns: v.boolean(),
	handler: async (ctx, { kind, userId, limit, used, epoch }) => {
		requireCount(limit, "limit");
		requireCount(used, "usage");
		if ((await getQuotaEpoch(ctx, kind)) !== epoch) {
			return false;
		}
		if (userId !== undefined && (await ctx.db.get("users", userId)) === null) {
			throw new Error("The user does not exist.");
		}
		const quota = await getQuota(ctx, kind, userId ?? "deployment");
		if (quota === null) {
			await ctx.db.insert("quotas", {
				kind,
				...(userId === undefined ? {} : { userId }),
				limit,
				used,
			});
		} else {
			await ctx.db.patch("quotas", quota._id, { limit, used });
		}
		return true;
	},
});

async function recountHeld(
	ctx: ActionCtx,
	kind: QuotaKind,
	userId: Id<"users"> | undefined,
) {
	let cursor: string | null = null;
	let epoch: number | null = null;
	let used = 0;
	for (let page = 0; page < recountMaxPages; page += 1) {
		const result: HeldPage = await ctx.runQuery(internal.quotas.readHeldPage, {
			kind,
			cursor,
			...(userId === undefined ? {} : { userId }),
		});
		epoch ??= result.epoch;
		if (result.epoch !== epoch) {
			return null;
		}
		used += result.used;
		if (result.isDone) {
			return { used, epoch };
		}
		cursor = result.continueCursor;
	}
	throw new Error("quota_reconcile_too_large");
}

async function setQuotaFromHeld(
	ctx: ActionCtx,
	kind: QuotaKind,
	userId: Id<"users"> | undefined,
	limit: number,
) {
	for (let attempt = 0; attempt < recountAttempts; attempt += 1) {
		const result = await recountHeld(ctx, kind, userId);
		if (result === null) {
			continue;
		}
		const applied: boolean = await ctx.runMutation(
			internal.quotas.applyReconciliation,
			{
				kind,
				...(userId === undefined ? {} : { userId }),
				limit,
				used: result.used,
				epoch: result.epoch,
			},
		);
		if (applied) {
			return;
		}
	}
	throw new Error("quota_reconcile_retry");
}

/** A quota that starts while its holder already holds some would understate usage. */
async function isHolding(ctx: QueryCtx, kind: QuotaKind, holder: QuotaHolder) {
	const held = await listHeld(ctx, kind, holder, {
		numItems: 1,
		maximumRowsRead: 1,
		cursor: null,
	});
	return held.page.length > 0;
}

export const set = internalMutation({
	args: {
		kind: quotaKind,
		userId: v.optional(v.id("users")),
		limit: v.number(),
	},
	returns: v.null(),
	handler: async (ctx, { kind, userId, limit }) => {
		requireCount(limit, "limit");
		if (userId !== undefined && (await ctx.db.get("users", userId)) === null) {
			throw new Error("The user does not exist.");
		}
		const holder = userId ?? "deployment";
		const quota = await getQuota(ctx, kind, holder);
		if (quota !== null) {
			await ctx.db.patch("quotas", quota._id, { limit });
			return null;
		}
		if (await isHolding(ctx, kind, holder)) {
			throw new Error(
				"The holder already holds some of this kind without a quota. Run quotas:reconcile.",
			);
		}
		await ctx.db.insert("quotas", {
			kind,
			...(userId === undefined ? {} : { userId }),
			limit,
			used: 0,
		});
		return null;
	},
});

/** Rebuild a holder's usage from what it holds, with a bounded, epoch-fenced recount. */
export const reconcile = internalAction({
	args: {
		kind: quotaKind,
		userId: v.optional(v.id("users")),
		limit: v.number(),
	},
	returns: v.null(),
	handler: async (ctx, { kind, userId, limit }) => {
		requireCount(limit, "limit");
		await setQuotaFromHeld(ctx, kind, userId, limit);
		return null;
	},
});
