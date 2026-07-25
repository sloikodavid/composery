import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { action, mutation, query, type QueryCtx } from "../_generated/server";
import {
	getUserByClerkId,
	requireActiveUser,
	requireActiveUserInAction,
	requireIdentity
} from "../authorization";
import { fetchRuntimeLogsSafely } from "../boxes/boxLogs";
import {
	vRecoveryStatus,
	type RecoveryStatus
} from "../boxes/boxRecoveryTypes";
import { boxMetricsSamples, vMetricsRange } from "../boxes/boxMetrics";
import { startBoxOperation } from "../boxes/boxOperations";
import { currentSuspensionReason, findBoxBySlug } from "../boxes/boxQueries";
import { latestRebuild, latestRepair, safeBox } from "../boxes/boxViews";
import { ownerCanReadBox } from "../boxes/boxAccess";
import {
	markSnapshotDeleting,
	snapshotView,
	startManualSnapshot
} from "../boxes/boxSnapshots";
import { websiteOrigin } from "../env";
import { polarServer } from "../billing/polar";
import { boxPath } from "../../lib/box-route";
import { isValidSlug, sanitizeSlug } from "../../lib/box-slug";

const CUSTOMER_PORTAL_BLOCKED_STATUSES = ["deleting", "deleted"] as const;
const BOX_LIST_MAXIMUM_ROWS_READ = 200;

// A slug change or reset forces a Let's Encrypt reissue, and every box shares
// CLOUD_DOMAIN's weekly certificate budget (50/week per apex, 5/week per
// repeated name), so the two reissuing operations share a per-box weekly cap.
// The staff console bypasses this on purpose.
const TLS_REISSUE_OPERATION_TYPES = ["reset", "change_slug"] as const;
const TLS_REISSUE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const TLS_REISSUE_CAP_PER_WEEK = 5;

async function assertTlsReissueBudget(ctx: QueryCtx, boxId: Id<"boxes">) {
	const since = Date.now() - TLS_REISSUE_WEEK_MS;
	let count = 0;
	for (const type of TLS_REISSUE_OPERATION_TYPES) {
		const rows = await ctx.db
			.query("box_operations")
			.withIndex("box_id_type_created_at", (builder) =>
				builder.eq("box_id", boxId).eq("type", type).gte("created_at", since)
			)
			.take(TLS_REISSUE_CAP_PER_WEEK);
		count += rows.length;
	}

	if (count >= TLS_REISSUE_CAP_PER_WEEK) {
		throw new ConvexError(
			"This box has changed its address or been reset too often this week. Try again later or contact support."
		);
	}
}

async function requireCurrentUserForBoxRead(ctx: QueryCtx) {
	const identity = await requireIdentity(ctx);
	const user = await getUserByClerkId(ctx, identity.subject);
	if (user?.suspended) {
		throw new ConvexError({
			kind: "user_suspended",
			reason: user.suspended_reason ?? ""
		});
	}
	return { identity, user };
}

// Resolve a slug to the caller's box or fail without revealing whether the slug
// exists.
async function requireOwnedBox(ctx: QueryCtx, userId: string, slug: string) {
	const box = await findBoxBySlug(ctx, slug);
	if (!box || box.user_id !== userId) throw new ConvexError("Box not found.");
	return box;
}

async function requireOwnedSnapshot(
	ctx: QueryCtx,
	userId: string,
	snapshotRowId: Id<"box_snapshots">
) {
	const snapshot = await ctx.db.get(snapshotRowId);
	if (!snapshot) throw new ConvexError("Snapshot not found.");
	const box = await ctx.db.get(snapshot.box_id);
	if (!box || box.user_id !== userId) {
		throw new ConvexError("Snapshot not found.");
	}
	return { box, snapshot };
}

function assertPortalAllowed(box: Doc<"boxes">) {
	if (
		CUSTOMER_PORTAL_BLOCKED_STATUSES.includes(
			box.status as (typeof CUSTOMER_PORTAL_BLOCKED_STATUSES)[number]
		)
	) {
		throw new ConvexError(
			"Subscription management is unavailable for this box."
		);
	}
}

export const list = query({
	args: {
		paginationOpts: paginationOptsValidator
	},
	handler: async (ctx, args) => {
		const { identity, user } = await requireCurrentUserForBoxRead(ctx);
		if (!user) {
			return {
				continueCursor: "",
				isDone: true,
				page: []
			};
		}

		const page = await ctx.db
			.query("boxes")
			.withIndex("user_id_created_at", (builder) =>
				builder.eq("user_id", identity.subject)
			)
			.order("desc")
			.filter((builder) => builder.neq(builder.field("status"), "deleted"))
			.paginate({
				...args.paginationOpts,
				maximumRowsRead: BOX_LIST_MAXIMUM_ROWS_READ
			});

		return { ...page, page: page.page.map(safeBox) };
	}
});

export const getById = query({
	args: {
		boxId: v.string()
	},
	handler: async (ctx, args) => {
		const { identity } = await requireCurrentUserForBoxRead(ctx);
		const boxId = ctx.db.normalizeId("boxes", args.boxId);
		const box = boxId ? await ctx.db.get(boxId) : null;

		if (!ownerCanReadBox(box, identity.subject)) {
			return null;
		}

		const subscription = box.polar_subscription_id
			? await ctx.runQuery(components.polar.lib.getSubscription, {
					id: box.polar_subscription_id
				})
			: null;

		const suspendedReason = await currentSuspensionReason(ctx, box);

		return {
			box: safeBox(box),
			subscription,
			suspendedReason,
			repair: await latestRepair(ctx.db, box._id),
			rebuild: await latestRebuild(ctx.db, box._id)
		};
	}
});

// The owner's view of the same Hetzner-side samples staff see.
export const metricsSeries = query({
	args: {
		slug: v.string(),
		range: v.optional(vMetricsRange)
	},
	handler: async (ctx, args) => {
		const { identity } = await requireCurrentUserForBoxRead(ctx);
		const box = await findBoxBySlug(ctx, args.slug);
		if (!box || box.user_id !== identity.subject) return [];

		return [
			{
				slug: box.slug,
				samples: await boxMetricsSamples(ctx, box._id, args.range ?? "24h")
			}
		];
	}
});

export const customerPortalUrl = action({
	args: {
		slug: v.string()
	},
	returns: v.object({
		url: v.string()
	}),
	handler: async (ctx, args): Promise<{ url: string }> => {
		const user = await requireActiveUserInAction(ctx);

		const box: Doc<"boxes"> | null = await ctx.runQuery(
			internal.boxes.boxQueries.boxByOwnerSlug,
			{
				userId: user.clerk_user_id,
				slug: sanitizeSlug(args.slug)
			}
		);
		if (!box) throw new ConvexError("Box not found.");
		assertPortalAllowed(box);

		const origin = websiteOrigin();

		const polar = polarServer();
		const polarCtx = ctx as unknown as Parameters<
			typeof polar.createCustomerPortalSession
		>[0];

		return await polar.createCustomerPortalSession(polarCtx, {
			userId: user.clerk_user_id,
			returnUrl: `${origin}${boxPath(box._id)}`
		});
	}
});

export const runtimeLogs = action({
	args: {
		slug: v.string()
	},
	returns: v.object({
		logs: v.union(v.string(), v.null())
	}),
	handler: async (ctx, args): Promise<{ logs: string | null }> => {
		const user = await requireActiveUserInAction(ctx);

		const box: Doc<"boxes"> | null = await ctx.runQuery(
			internal.boxes.boxQueries.boxByOwnerSlug,
			{
				userId: user.clerk_user_id,
				slug: sanitizeSlug(args.slug)
			}
		);
		if (!box) throw new ConvexError("Box not found.");
		if (box.status !== "running") return { logs: null };

		return await fetchRuntimeLogsSafely(ctx, box._id);
	}
});

export const recoveryStatus = action({
	args: { slug: v.string() },
	returns: vRecoveryStatus,
	handler: async (ctx, args): Promise<RecoveryStatus> => {
		const user = await requireActiveUserInAction(ctx);
		const box = await ctx.runQuery(internal.boxes.boxQueries.boxByOwnerSlug, {
			userId: user.clerk_user_id,
			slug: sanitizeSlug(args.slug)
		});
		if (!box) throw new ConvexError("Box not found.");
		return await ctx.runAction(internal.boxes.boxRecovery.status, {
			boxId: box._id
		});
	}
});

export const recover = action({
	args: { slug: v.string() },
	handler: async (ctx, args): Promise<void> => {
		const user = await requireActiveUserInAction(ctx);
		const box = await ctx.runQuery(internal.boxes.boxQueries.boxByOwnerSlug, {
			userId: user.clerk_user_id,
			slug: sanitizeSlug(args.slug)
		});
		if (!box) throw new ConvexError("Box not found.");
		// A null id means an identical repair is already in flight. Returning
		// quietly would toast "Repair started" over a request that started
		// nothing, which is the same lie as a repair that reports no outcome.
		const operationId = await startBoxOperation(ctx, box._id, "recover", {
			idempotencyKey: `recover:${box._id}`
		});
		if (!operationId) {
			throw new ConvexError("This box is already being repaired.");
		}
	}
});

export const rebuild = action({
	args: { slug: v.string() },
	handler: async (ctx, args): Promise<void> => {
		const user = await requireActiveUserInAction(ctx);
		const box = await ctx.runQuery(internal.boxes.boxQueries.boxByOwnerSlug, {
			userId: user.clerk_user_id,
			slug: sanitizeSlug(args.slug)
		});
		if (!box) throw new ConvexError("Box not found.");
		// Null means an identical rebuild is already in flight; reporting "Rebuild
		// started" over a request that started nothing is the same lie as an
		// operation that never reports an outcome. A retry after a failure reuses
		// this same key while the failed operation is settled, so it starts a fresh
		// rebuild that resumes from the box's parking volume.
		const operationId = await startBoxOperation(ctx, box._id, "rebuild", {
			idempotencyKey: `rebuild:${box._id}`
		});
		if (!operationId) {
			throw new ConvexError("This box is already being rebuilt.");
		}
	}
});

export const retryProvision = mutation({
	args: {
		slug: v.string()
	},
	handler: async (ctx, args) => {
		const user = await requireActiveUser(ctx);
		const box = await requireOwnedBox(ctx, user.clerkUserId, args.slug);

		await startBoxOperation(ctx, box._id, "provision", {
			idempotencyKey: `provision:${box._id}`
		});
	}
});

export const stop = mutation({
	args: {
		slug: v.string()
	},
	handler: async (ctx, args) => {
		const user = await requireActiveUser(ctx);
		const box = await requireOwnedBox(ctx, user.clerkUserId, args.slug);

		await startBoxOperation(ctx, box._id, "stop", {
			idempotencyKey: `stop:${box._id}`
		});
	}
});

export const start = mutation({
	args: {
		slug: v.string()
	},
	handler: async (ctx, args) => {
		const user = await requireActiveUser(ctx);
		const box = await requireOwnedBox(ctx, user.clerkUserId, args.slug);

		await startBoxOperation(ctx, box._id, "start", {
			idempotencyKey: `start:${box._id}`
		});
	}
});

export const reset = mutation({
	args: {
		confirmation: v.string(),
		slug: v.string()
	},
	handler: async (ctx, args) => {
		const user = await requireActiveUser(ctx);
		const box = await requireOwnedBox(ctx, user.clerkUserId, args.slug);
		if (args.confirmation !== box.slug) {
			throw new ConvexError("Type the box slug to reset.");
		}
		await assertTlsReissueBudget(ctx, box._id);

		await startBoxOperation(ctx, box._id, "reset", {
			idempotencyKey: `reset:${box._id}`
		});
	}
});

export const changeSlug = mutation({
	args: {
		newSlug: v.string(),
		slug: v.string()
	},
	handler: async (ctx, args) => {
		const user = await requireActiveUser(ctx);
		const newSlug = sanitizeSlug(args.newSlug);
		if (!isValidSlug(newSlug)) throw new ConvexError("Slug is unavailable.");

		const box = await requireOwnedBox(ctx, user.clerkUserId, args.slug);
		await assertTlsReissueBudget(ctx, box._id);

		await startBoxOperation(ctx, box._id, "change_slug", {
			idempotencyKey: `change_slug:${box._id}:${newSlug}`,
			reservedSlug: newSlug,
			metadata: { oldSlug: box.slug, newSlug },
			workflowArgs: { newSlug }
		});

		return { slug: newSlug };
	}
});

export const snapshots = query({
	args: {
		slug: v.string()
	},
	handler: async (ctx, args) => {
		const { identity } = await requireCurrentUserForBoxRead(ctx);
		const box = await findBoxBySlug(ctx, args.slug);
		if (!box || box.user_id !== identity.subject) return [];

		const rows = await ctx.db
			.query("box_snapshots")
			.withIndex("box_id_created_at", (builder) =>
				builder.eq("box_id", box._id)
			)
			.order("desc")
			.take(100);

		return rows.map(snapshotView);
	}
});

export const createSnapshot = mutation({
	args: {
		slug: v.string()
	},
	handler: async (ctx, args) => {
		const user = await requireActiveUser(ctx);
		const box = await requireOwnedBox(ctx, user.clerkUserId, args.slug);
		await startManualSnapshot(ctx, box, "snapshot");
	}
});

export const restoreSnapshot = mutation({
	args: {
		snapshotId: v.id("box_snapshots")
	},
	handler: async (ctx, args) => {
		const user = await requireActiveUser(ctx);
		const { box, snapshot } = await requireOwnedSnapshot(
			ctx,
			user.clerkUserId,
			args.snapshotId
		);
		if (snapshot.status !== "complete") {
			throw new ConvexError("Only a finished snapshot can be restored.");
		}
		const operationId = await startBoxOperation(ctx, box._id, "restore", {
			idempotencyKey: `restore:${box._id}:${args.snapshotId}`,
			workflowArgs: { snapshotRowId: args.snapshotId }
		});
		if (!operationId) {
			throw new ConvexError("Restore is already in progress.");
		}
	}
});

export const deleteSnapshot = mutation({
	args: {
		snapshotId: v.id("box_snapshots")
	},
	handler: async (ctx, args) => {
		const user = await requireActiveUser(ctx);
		await requireOwnedSnapshot(ctx, user.clerkUserId, args.snapshotId);
		await markSnapshotDeleting(ctx, args.snapshotId);
		await ctx.scheduler.runAfter(0, internal.boxes.boxSnapshots.runDelete, {
			snapshotRowId: args.snapshotId
		});
	}
});
