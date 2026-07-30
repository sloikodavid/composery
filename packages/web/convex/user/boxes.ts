import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { action, mutation, query, type QueryCtx } from "../_generated/server";
import {
	currentUserForRead,
	requireActiveUser,
	requireActiveUserInAction
} from "../users";
import { fetchRuntimeLogsSafely } from "../boxes/logs";
import { vRecoveryStatus, type RecoveryStatus } from "../boxes/recoveryTypes";
import { boxMetricsSamples, vMetricsRange } from "../boxes/metrics";
import { startBoxOperation } from "../boxes/operations";
import { currentSuspensionReason, findOwnedBoxBySlug } from "../boxes/queries";
import {
	boxRuntimeStanding,
	latestFailure,
	latestRepair,
	latestUpdate,
	safeBox
} from "../boxes/views";
import { ownerCanReadBox } from "../boxes/access";
import {
	markSnapshotDeleting,
	snapshotView,
	startManualSnapshot
} from "../boxes/snapshots";
import { websiteOrigin } from "../env";
import { polarServer } from "../billing/polar";
import { boxPath } from "../../lib/box-route";
import {
	BOX_PLANS,
	isValidManualSnapshotCap,
	planAllowsManualSnapshots
} from "../../lib/box-plan";
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

// Resolve a slug to the caller's box or fail without revealing whether the slug
// exists.
async function requireOwnedBox(ctx: QueryCtx, userId: string, slug: string) {
	const box = await findOwnedBoxBySlug(ctx, userId, slug);
	if (!box) throw new ConvexError("Box not found.");
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
		const { identity, user } = await currentUserForRead(ctx);
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
		const { identity } = await currentUserForRead(ctx);
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
			failure: await latestFailure(ctx.db, box._id),
			repair: await latestRepair(ctx.db, box._id),
			update: await latestUpdate(ctx.db, box._id),
			runtime: await boxRuntimeStanding(ctx.db, box)
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
		const { identity } = await currentUserForRead(ctx);
		const box = await findOwnedBoxBySlug(ctx, identity.subject, args.slug);
		if (!box) return [];

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
			internal.boxes.queries.boxByOwnerSlug,
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
			internal.boxes.queries.boxByOwnerSlug,
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
		const box = await ctx.runQuery(internal.boxes.queries.boxByOwnerSlug, {
			userId: user.clerk_user_id,
			slug: sanitizeSlug(args.slug)
		});
		if (!box) throw new ConvexError("Box not found.");
		return await ctx.runAction(internal.boxes.recovery.status, {
			boxId: box._id
		});
	}
});

export const repair = action({
	args: { slug: v.string() },
	handler: async (ctx, args): Promise<void> => {
		const user = await requireActiveUserInAction(ctx);
		const box = await ctx.runQuery(internal.boxes.queries.boxByOwnerSlug, {
			userId: user.clerk_user_id,
			slug: sanitizeSlug(args.slug)
		});
		if (!box) throw new ConvexError("Box not found.");
		// Null means an identical repair is already in flight; reporting "Repair
		// started" over a request that started nothing is the same lie as an
		// operation that never reports an outcome. A retry after a failure reuses
		// this same key while the failed operation is settled, so it starts a fresh
		// repair that resumes from the box's parking volume.
		const operationId = await startBoxOperation(ctx, box._id, "repair", {
			idempotencyKey: `repair:${box._id}`,
			trigger: "owner"
		});
		if (!operationId) {
			throw new ConvexError("This box is already being repaired.");
		}
	}
});

export const update = action({
	args: { slug: v.string() },
	handler: async (ctx, args): Promise<void> => {
		const user = await requireActiveUserInAction(ctx);
		const box = await ctx.runQuery(internal.boxes.queries.boxByOwnerSlug, {
			userId: user.clerk_user_id,
			slug: sanitizeSlug(args.slug)
		});
		if (!box) throw new ConvexError("Box not found.");
		// Keyed per box rather than per target image on purpose. Two presses of
		// Update are the same request, and the second must not queue a second
		// container recreate behind the first. A retry after a failure reuses the
		// key once the failed operation has settled, so it starts a fresh attempt.
		const operationId = await startBoxOperation(ctx, box._id, "update", {
			idempotencyKey: `update:${box._id}`,
			trigger: "owner"
		});
		if (!operationId) {
			throw new ConvexError("This box is already being updated.");
		}
	}
});

export const retryCreate = mutation({
	args: {
		slug: v.string()
	},
	handler: async (ctx, args) => {
		const user = await requireActiveUser(ctx);
		const box = await requireOwnedBox(ctx, user.clerk_user_id, args.slug);

		await startBoxOperation(ctx, box._id, "create", {
			idempotencyKey: `create:${box._id}`,
			trigger: "owner"
		});
	}
});

export const stop = mutation({
	args: {
		slug: v.string()
	},
	handler: async (ctx, args) => {
		const user = await requireActiveUser(ctx);
		const box = await requireOwnedBox(ctx, user.clerk_user_id, args.slug);

		await startBoxOperation(ctx, box._id, "stop", {
			idempotencyKey: `stop:${box._id}`,
			trigger: "owner"
		});
	}
});

export const start = mutation({
	args: {
		slug: v.string()
	},
	handler: async (ctx, args) => {
		const user = await requireActiveUser(ctx);
		const box = await requireOwnedBox(ctx, user.clerk_user_id, args.slug);

		await startBoxOperation(ctx, box._id, "start", {
			idempotencyKey: `start:${box._id}`,
			trigger: "owner"
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
		const box = await requireOwnedBox(ctx, user.clerk_user_id, args.slug);
		if (args.confirmation !== box.slug) {
			throw new ConvexError("Type the box slug to reset.");
		}
		await assertTlsReissueBudget(ctx, box._id);

		await startBoxOperation(ctx, box._id, "reset", {
			idempotencyKey: `reset:${box._id}`,
			trigger: "owner"
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

		const box = await requireOwnedBox(ctx, user.clerk_user_id, args.slug);
		await assertTlsReissueBudget(ctx, box._id);

		await startBoxOperation(ctx, box._id, "change_slug", {
			idempotencyKey: `change-slug:${box._id}:${newSlug}`,
			trigger: "owner",
			reservedSlug: newSlug,
			metadata: { oldSlug: box.slug, newSlug },
			workflowArgs: { newSlug }
		});

		return { slug: newSlug };
	}
});

// How the box's snapshot allowance is divided between the daily automatic ones
// and the ones its owner takes themselves.
//
// It moves slots between two columns and never changes how many there are, so it
// costs the fleet nothing, touches no infrastructure, and is not a box operation
// - a box mid-repair can still be re-split. Nothing is deleted either: lowering a
// side below what is already held simply stops new ones being taken on that side
// until the existing ones expire or the owner removes them, which is the same
// rule a full manual allowance has always followed.
export const setSnapshotSplit = mutation({
	args: {
		manualCap: v.number(),
		slug: v.string()
	},
	handler: async (ctx, args) => {
		const user = await requireActiveUser(ctx);
		const box = await requireOwnedBox(ctx, user.clerk_user_id, args.slug);

		if (!isValidManualSnapshotCap(box.plan, args.manualCap)) {
			throw new ConvexError(
				planAllowsManualSnapshots(box.plan)
					? `${BOX_PLANS[box.plan].label} includes ${BOX_PLANS[box.plan].snapshotCap} snapshots, so between 0 and ${BOX_PLANS[box.plan].snapshotCap} of them can be yours to take.`
					: `${BOX_PLANS[box.plan].label} takes its snapshots automatically, so there is no split to set.`
			);
		}

		await ctx.db.patch(box._id, {
			manual_snapshot_cap: args.manualCap,
			updated_at: Date.now()
		});
	}
});

export const snapshots = query({
	args: {
		slug: v.string()
	},
	handler: async (ctx, args) => {
		const { identity } = await currentUserForRead(ctx);
		const box = await findOwnedBoxBySlug(ctx, identity.subject, args.slug);
		if (!box) return [];

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
		const box = await requireOwnedBox(ctx, user.clerk_user_id, args.slug);
		await startManualSnapshot(ctx, box, "snapshot", "owner");
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
			user.clerk_user_id,
			args.snapshotId
		);
		if (snapshot.status !== "complete") {
			throw new ConvexError("Only a finished snapshot can be restored.");
		}
		const operationId = await startBoxOperation(ctx, box._id, "restore", {
			idempotencyKey: `restore:${box._id}:${args.snapshotId}`,
			trigger: "owner",
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
		await requireOwnedSnapshot(ctx, user.clerk_user_id, args.snapshotId);
		await markSnapshotDeleting(ctx, args.snapshotId);
		await ctx.scheduler.runAfter(0, internal.boxes.snapshots.runDelete, {
			snapshotRowId: args.snapshotId
		});
	}
});
