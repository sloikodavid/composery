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
import { boxMetricsSamples, vMetricsRange } from "../boxes/boxMetrics";
import { hashBoxPassword } from "../boxes/boxPassword";
import { startBoxOperation } from "../boxes/boxOperations";
import { findBoxBySlug, latestSuspensionReason } from "../boxes/boxQueries";
import { safeBox } from "../boxes/boxViews";
import {
	markSnapshotDeleting,
	snapshotView,
	startManualSnapshot
} from "../boxes/boxSnapshots";
import { websiteOrigin } from "../env";
import { polarServer } from "../billing/polar";
import { isValidSlug, sanitizeSlug } from "../../lib/box-slug";

const CUSTOMER_PORTAL_BLOCKED_STATUSES = ["deleting", "deleted"] as const;
const BOX_LIST_MAXIMUM_ROWS_READ = 200;

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

export const getBySlug = query({
	args: {
		slug: v.string()
	},
	handler: async (ctx, args) => {
		const { identity } = await requireCurrentUserForBoxRead(ctx);
		const box = await findBoxBySlug(ctx, args.slug);

		if (!box || box.user_id !== identity.subject) return null;

		const subscription = await ctx.runQuery(
			components.polar.lib.getSubscription,
			{
				id: box.polar_subscription_id
			}
		);

		const suspendedReason =
			box.status === "suspended" || box.status === "suspending"
				? await latestSuspensionReason(ctx, box._id)
				: null;

		return {
			box: safeBox(box),
			subscription,
			suspendedReason
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
			returnUrl: `${origin}/boxes/${box.slug}`
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

		await startBoxOperation(ctx, box._id, "change_slug", {
			idempotencyKey: `change_slug:${box._id}:${newSlug}`,
			reservedSlug: newSlug,
			metadata: { oldSlug: box.slug, newSlug },
			workflowArgs: { newSlug }
		});

		return { slug: newSlug };
	}
});

export const changePassword = action({
	args: {
		password: v.string(),
		slug: v.string()
	},
	handler: async (ctx, args) => {
		const user = await requireActiveUserInAction(ctx);

		const box = await ctx.runQuery(internal.boxes.boxQueries.boxByOwnerSlug, {
			userId: user.clerk_user_id,
			slug: sanitizeSlug(args.slug)
		});
		if (!box) throw new ConvexError("Box not found.");

		const runtimeAuthHash = await hashBoxPassword(args.password);
		const operationId = await startBoxOperation(
			ctx,
			box._id,
			"change_password",
			{
				idempotencyKey: `change_password:${box._id}`,
				workflowArgs: { runtimeAuthHash }
			}
		);
		if (!operationId)
			throw new ConvexError("Password change is already in progress.");
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
