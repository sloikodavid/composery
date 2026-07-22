import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { components, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import {
	action,
	internalMutation,
	mutation,
	query,
	type MutationCtx,
	type QueryCtx
} from "../_generated/server";
import {
	getUserByClerkId,
	publicUser,
	requireCapability,
	requireCapabilityInAction
} from "../authorization";
import { fetchRuntimeLogsSafely } from "../boxes/boxLogs";
import {
	vRecoveryStatus,
	type RecoveryStatus
} from "../boxes/boxRecoveryTypes";
import {
	beginBoxOperationRecord,
	startBoxOperation,
	startBoxSuspension
} from "../boxes/boxOperations";
import { currentSuspensionReason } from "../boxes/boxQueries";
import { appendBoxEvent } from "../boxes/boxEvents";
import { assertSlugAvailable } from "../boxes/slugAvailability";
import { capacityBlockMessage, readCapacityUsage } from "../boxes/boxCapacity";
import { reconcileCapacityAlert } from "../boxes/capacityAlerts";
import { readGlobalSettings } from "../settings";
import { startWorkflow } from "../boxes/workflows/boxWorkflow";
import { boxDeletionIdempotencyKey } from "../accountDeletionLogic";
import { requiredEnv } from "../env";
import { staffBox } from "../boxes/boxViews";
import {
	markSnapshotDeleting,
	snapshotView,
	startManualSnapshot
} from "../boxes/boxSnapshots";
import { isValidSlug, sanitizeSlug } from "../../lib/box-slug";

const STAFF_BOX_LIST_LIMIT = 50;
const STAFF_BOX_SEARCH_SCAN_LIMIT = 500;
const STAFF_FAILURE_FEED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const STAFF_FAILURE_FEED_LIMIT = 25;
const STAFF_FAILURE_DISMISS_BATCH = 100;

async function usersByClerkIds(ctx: QueryCtx, clerkUserIds: Iterable<string>) {
	const users = new Map<string, Doc<"users">>();
	for (const clerkUserId of new Set(clerkUserIds)) {
		const user = await getUserByClerkId(ctx, clerkUserId);
		if (user) users.set(clerkUserId, user);
	}
	return users;
}

function boxMatchesSearch(
	box: Doc<"boxes">,
	user: Doc<"users"> | undefined,
	term: string
) {
	return (
		box._id.toLowerCase().includes(term) ||
		box.slug.includes(term) ||
		box.user_id.toLowerCase().includes(term) ||
		(user?.email ?? "").toLowerCase().includes(term) ||
		(box.polar_subscription_id ?? "").toLowerCase().includes(term)
	);
}

function addBoxCandidate(
	candidates: Map<Doc<"boxes">["_id"], Doc<"boxes">>,
	box: Doc<"boxes"> | null | undefined
) {
	if (box) candidates.set(box._id, box);
}

export const searchBoxes = query({
	args: {
		query: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await requireCapability(ctx, "staff_console");
		const rawTerm = (args.query ?? "").trim();
		const term = rawTerm.toLowerCase();

		const candidates = new Map<Doc<"boxes">["_id"], Doc<"boxes">>();
		const recentLimit = term
			? STAFF_BOX_SEARCH_SCAN_LIMIT
			: STAFF_BOX_LIST_LIMIT;
		const recentBoxes = await ctx.db
			.query("boxes")
			.withIndex("created_at")
			.order("desc")
			.take(recentLimit);
		for (const box of recentBoxes) addBoxCandidate(candidates, box);

		if (term) {
			const boxId = ctx.db.normalizeId("boxes", rawTerm);
			if (boxId) addBoxCandidate(candidates, await ctx.db.get(boxId));

			const slug = sanitizeSlug(rawTerm);
			if (isValidSlug(slug)) {
				const slugBoxes = await ctx.db
					.query("boxes")
					.withIndex("slug", (query) => query.eq("slug", slug))
					.collect();
				for (const box of slugBoxes) addBoxCandidate(candidates, box);
			}

			addBoxCandidate(
				candidates,
				await ctx.db
					.query("boxes")
					.withIndex("polar_subscription_id", (query) =>
						query.eq("polar_subscription_id", rawTerm)
					)
					.first()
			);

			const user = await ctx.db
				.query("users")
				.withIndex("email", (query) => query.eq("email", term))
				.first();
			const userIds = new Set([rawTerm]);
			if (user) userIds.add(user.clerk_user_id);
			for (const userId of userIds) {
				const userBoxes = await ctx.db
					.query("boxes")
					.withIndex("user_id", (query) => query.eq("user_id", userId))
					.order("desc")
					.take(STAFF_BOX_LIST_LIMIT);
				for (const box of userBoxes) addBoxCandidate(candidates, box);
			}
		}

		const boxes = [...candidates.values()];
		const usersById = await usersByClerkIds(
			ctx,
			boxes.map((box) => box.user_id)
		);

		return boxes
			.filter((box) => {
				if (!term) return true;
				const user = usersById.get(box.user_id);
				return boxMatchesSearch(box, user, term);
			})
			.sort((first, second) => second.created_at - first.created_at)
			.slice(0, STAFF_BOX_LIST_LIMIT)
			.map((box) => staffBox(box, usersById.get(box.user_id)));
	}
});

// Fleet-wide failed-operation feed for the console. Snapshot failures never flip
// box status, so the status-based "failed boxes" count misses them - a full
// Hetzner snapshot limit would fail every box's daily snapshot invisibly. This
// surfaces those (and every other operation failure) with the error text staff
// need to act on.
export const recentFailedOperations = query({
	args: {},
	handler: async (ctx) => {
		await requireCapability(ctx, "staff_console");
		const since = Date.now() - STAFF_FAILURE_FEED_WINDOW_MS;
		const operations = await ctx.db
			.query("box_operations")
			.withIndex("status_dismissed_created_at", (builder) =>
				builder
					.eq("status", "failed")
					.eq("dismissed_at", undefined)
					.gte("created_at", since)
			)
			.order("desc")
			.take(STAFF_FAILURE_FEED_LIMIT);

		const failures = [];
		for (const operation of operations) {
			const box = await ctx.db.get(operation.box_id);
			if (!box) continue;
			failures.push({
				id: operation._id,
				boxId: box._id,
				type: operation.type,
				slug: box.slug,
				lastError: operation.last_error ?? null,
				createdAt: operation.created_at
			});
		}
		return failures;
	}
});

export const dismissFailedOperation = mutation({
	args: {
		operationId: v.id("box_operations")
	},
	handler: async (ctx, args) => {
		const staffUser = await requireCapability(ctx, "box_operations");
		const operation = await ctx.db.get(args.operationId);
		if (!operation || operation.status !== "failed" || operation.dismissed_at) {
			return;
		}

		await ctx.db.patch(operation._id, {
			dismissed_at: Date.now(),
			dismissed_by: staffUser.clerk_user_id
		});
	}
});

async function dismissFailedOperationBatch(
	ctx: MutationCtx,
	dismissedBy: string,
	since: number
) {
	const operations = await ctx.db
		.query("box_operations")
		.withIndex("status_dismissed_created_at", (query) =>
			query
				.eq("status", "failed")
				.eq("dismissed_at", undefined)
				.gte("created_at", since)
		)
		.take(STAFF_FAILURE_DISMISS_BATCH);
	const timestamp = Date.now();
	for (const operation of operations) {
		await ctx.db.patch(operation._id, {
			dismissed_at: timestamp,
			dismissed_by: dismissedBy
		});
	}
	return operations.length === STAFF_FAILURE_DISMISS_BATCH;
}

export const dismissAllFailedOperations = mutation({
	args: {},
	handler: async (ctx) => {
		const staffUser = await requireCapability(ctx, "box_operations");
		const since = Date.now() - STAFF_FAILURE_FEED_WINDOW_MS;
		const hasMore = await dismissFailedOperationBatch(
			ctx,
			staffUser.clerk_user_id,
			since
		);
		if (hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.staff.boxes.dismissAllFailedOperationsBatch,
				{ dismissedBy: staffUser.clerk_user_id, since }
			);
		}
	}
});

export const dismissAllFailedOperationsBatch = internalMutation({
	args: { dismissedBy: v.string(), since: v.number() },
	handler: async (ctx, args) => {
		const hasMore = await dismissFailedOperationBatch(
			ctx,
			args.dismissedBy,
			args.since
		);
		if (hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.staff.boxes.dismissAllFailedOperationsBatch,
				args
			);
		}
	}
});

export const boxDetail = query({
	args: {
		boxId: v.string()
	},
	handler: async (ctx, args) => {
		await requireCapability(ctx, "staff_console");
		const boxId = ctx.db.normalizeId("boxes", args.boxId);
		const box = boxId ? await ctx.db.get(boxId) : null;
		if (!box) return null;

		const user = await getUserByClerkId(ctx, box.user_id);
		const subscription = box.polar_subscription_id
			? await ctx.runQuery(components.polar.lib.getSubscription, {
					id: box.polar_subscription_id
				})
			: null;

		const suspendedReason = await currentSuspensionReason(ctx, box);

		return {
			box: staffBox(box, user),
			user: user ? publicUser(user) : null,
			subscription,
			suspendedReason
		};
	}
});

export const auditOperations = query({
	args: {
		boxId: v.id("boxes"),
		paginationOpts: paginationOptsValidator
	},
	handler: async (ctx, args) => {
		await requireCapability(ctx, "staff_console");
		return await ctx.db
			.query("box_operations")
			.withIndex("box_id", (query) => query.eq("box_id", args.boxId))
			.order("desc")
			.paginate(args.paginationOpts);
	}
});

export const auditEvents = query({
	args: {
		boxId: v.id("boxes"),
		paginationOpts: paginationOptsValidator
	},
	handler: async (ctx, args) => {
		await requireCapability(ctx, "staff_console");
		return await ctx.db
			.query("box_events")
			.withIndex("box_id_created_at", (query) => query.eq("box_id", args.boxId))
			.order("desc")
			.paginate(args.paginationOpts);
	}
});

export const retryProvisionBox = mutation({
	args: {
		boxId: v.id("boxes")
	},
	handler: async (ctx, args) => {
		await requireCapability(ctx, "box_operations");
		await startBoxOperation(ctx, args.boxId, "provision", {
			idempotencyKey: `staff-provision:${args.boxId}`
		});
	}
});

// Provision a box for a user without a paid checkout - a staff comp. It reuses
// every guard a paid box gets (slug identity, live capacity budget) and is fully
// audited (comped_by on the box, box event, provision operation). A comp burns
// real infrastructure, so it counts against capacity and is gated behind its own
// capability rather than ordinary box/checkout powers.
export const grantComp = mutation({
	args: {
		email: v.string(),
		slug: v.string(),
		reason: v.string()
	},
	handler: async (ctx, args) => {
		const staffUser = await requireCapability(ctx, "box_comp");

		const reason = args.reason.trim();
		if (!reason) throw new ConvexError("A comp reason is required.");

		const targetUser = await ctx.db
			.query("users")
			.withIndex("email", (query) =>
				query.eq("email", args.email.trim().toLowerCase())
			)
			.first();
		if (!targetUser) throw new ConvexError("User not found.");
		if (targetUser.suspended) throw new ConvexError("User is suspended.");
		if (targetUser.deletion_pending) {
			throw new ConvexError("Account deletion is in progress for this user.");
		}

		const slug = sanitizeSlug(args.slug);
		if (!isValidSlug(slug)) throw new ConvexError("Slug is unavailable.");
		await assertSlugAvailable(ctx, slug);

		const settings = await readGlobalSettings(ctx);
		const capacity = await readCapacityUsage(ctx, settings);
		if (!capacity.checkoutAvailable) {
			throw new ConvexError(
				capacityBlockMessage(capacity.blockReason) ??
					"Infrastructure capacity is unavailable."
			);
		}

		const timestamp = Date.now();
		const boxId = await ctx.db.insert("boxes", {
			user_id: targetUser.clerk_user_id,
			slug,
			status: "provisioning",
			runtime_image: requiredEnv("RUNTIME_IMAGE"),
			comped_by: staffUser.clerk_user_id,
			comped_at: timestamp,
			comp_reason: reason,
			created_at: timestamp,
			updated_at: timestamp
		});
		await reconcileCapacityAlert(ctx);

		const box = await ctx.db.get(boxId);
		if (!box) throw new ConvexError("Box creation failed.");

		const operationId = await beginBoxOperationRecord(ctx, box, {
			type: "provision",
			idempotencyKey: `provision:${boxId}`,
			targetStatus: "provisioning",
			metadata: { compedBy: staffUser.clerk_user_id, reason }
		});
		if (!operationId)
			throw new ConvexError("Provision operation already exists.");

		await appendBoxEvent(ctx, box, "box.provisioning_started", {
			message: `Comped by ${staffUser.email}: ${reason}`,
			metadata: { operationId, compedBy: staffUser.clerk_user_id }
		});

		await startWorkflow(
			ctx,
			internal.boxes.workflows.provisionBox.provisionBox,
			{ boxId, operationId }
		);

		return { boxId };
	}
});

// Take back a comp. Paid boxes end by revoking their Polar subscription; a comp
// has none, so this is the only teardown lever for one.
export const revokeComp = mutation({
	args: {
		boxId: v.id("boxes")
	},
	handler: async (ctx, args) => {
		await requireCapability(ctx, "box_comp");
		const box = await ctx.db.get(args.boxId);
		if (!box) throw new ConvexError("Box not found.");
		if (box.comped_at === undefined) {
			throw new ConvexError("This box is not a comp.");
		}
		await startBoxOperation(ctx, box._id, "delete", {
			idempotencyKey: boxDeletionIdempotencyKey(box)
		});
	}
});

export const resetBox = mutation({
	args: {
		boxId: v.id("boxes")
	},
	handler: async (ctx, args) => {
		await requireCapability(ctx, "box_operations");
		await startBoxOperation(ctx, args.boxId, "reset", {
			idempotencyKey: `staff-reset:${args.boxId}`
		});
	}
});

export const changeBoxSlug = mutation({
	args: {
		boxId: v.id("boxes"),
		newSlug: v.string()
	},
	handler: async (ctx, args) => {
		await requireCapability(ctx, "box_operations");
		const newSlug = sanitizeSlug(args.newSlug);
		if (!isValidSlug(newSlug)) throw new ConvexError("Slug is unavailable.");

		await startBoxOperation(ctx, args.boxId, "change_slug", {
			idempotencyKey: `staff-change-slug:${args.boxId}:${newSlug}`,
			reservedSlug: newSlug,
			metadata: { newSlug },
			workflowArgs: { newSlug }
		});
	}
});

export const stopBox = mutation({
	args: {
		boxId: v.id("boxes")
	},
	handler: async (ctx, args) => {
		await requireCapability(ctx, "box_operations");
		await startBoxOperation(ctx, args.boxId, "stop", {
			idempotencyKey: `staff-stop:${args.boxId}`
		});
	}
});

export const startBox = mutation({
	args: {
		boxId: v.id("boxes")
	},
	handler: async (ctx, args) => {
		await requireCapability(ctx, "box_operations");
		await startBoxOperation(ctx, args.boxId, "start", {
			idempotencyKey: `staff-start:${args.boxId}`
		});
	}
});

export const runtimeLogs = action({
	args: {
		boxId: v.id("boxes")
	},
	returns: v.object({
		logs: v.union(v.string(), v.null())
	}),
	handler: async (ctx, args): Promise<{ logs: string | null }> => {
		await requireCapabilityInAction(ctx, "box_operations");

		const box = await ctx.runQuery(
			internal.boxes.boxQueries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		if (!box) throw new ConvexError("Box not found.");
		if (box.status !== "running") return { logs: null };

		return await fetchRuntimeLogsSafely(ctx, box._id);
	}
});

export const recoveryStatus = action({
	args: { boxId: v.id("boxes") },
	returns: vRecoveryStatus,
	handler: async (ctx, args): Promise<RecoveryStatus> => {
		await requireCapabilityInAction(ctx, "box_operations");
		const box = await ctx.runQuery(
			internal.boxes.boxQueries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		if (!box) throw new ConvexError("Box not found.");
		return await ctx.runAction(internal.boxes.boxRecovery.status, {
			boxId: box._id
		});
	}
});

export const recover = action({
	args: { boxId: v.id("boxes") },
	handler: async (ctx, args): Promise<void> => {
		await requireCapabilityInAction(ctx, "box_operations");
		const box = await ctx.runQuery(
			internal.boxes.boxQueries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		if (!box) throw new ConvexError("Box not found.");
		await startBoxOperation(ctx, box._id, "recover", {
			idempotencyKey: `staff-recover:${box._id}`
		});
	}
});

export const suspendBox = action({
	args: {
		boxId: v.id("boxes"),
		reason: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await requireCapabilityInAction(ctx, "box_operations");
		await startBoxSuspension(ctx, {
			boxId: args.boxId,
			idempotencyKeyPrefix: "staff-suspend",
			reason: args.reason,
			suspend: true
		});
	}
});

export const unsuspendBox = action({
	args: {
		boxId: v.id("boxes")
	},
	handler: async (ctx, args) => {
		await requireCapabilityInAction(ctx, "box_operations");
		await startBoxSuspension(ctx, {
			boxId: args.boxId,
			idempotencyKeyPrefix: "staff-unsuspend",
			suspend: false
		});
	}
});

export const boxSnapshots = query({
	args: {
		boxId: v.id("boxes")
	},
	handler: async (ctx, args) => {
		await requireCapability(ctx, "staff_console");
		const rows = await ctx.db
			.query("box_snapshots")
			.withIndex("box_id_created_at", (builder) =>
				builder.eq("box_id", args.boxId)
			)
			.order("desc")
			.take(100);

		return rows.map(snapshotView);
	}
});

export const createBoxSnapshot = mutation({
	args: {
		boxId: v.id("boxes")
	},
	handler: async (ctx, args) => {
		await requireCapability(ctx, "box_operations");
		const box = await ctx.db.get(args.boxId);
		if (!box) throw new ConvexError("Box not found.");
		await startManualSnapshot(ctx, box, "staff-snapshot");
	}
});

export const restoreSnapshot = mutation({
	args: {
		snapshotId: v.id("box_snapshots")
	},
	handler: async (ctx, args) => {
		await requireCapability(ctx, "box_operations");
		const snapshot = await ctx.db.get(args.snapshotId);
		if (!snapshot) throw new ConvexError("Snapshot not found.");
		if (snapshot.status !== "complete") {
			throw new ConvexError("Only a finished snapshot can be restored.");
		}
		const box = await ctx.db.get(snapshot.box_id);
		if (!box) throw new ConvexError("Box not found.");
		const operationId = await startBoxOperation(ctx, box._id, "restore", {
			idempotencyKey: `staff-restore:${box._id}:${args.snapshotId}`,
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
		await requireCapability(ctx, "box_operations");
		const snapshot = await ctx.db.get(args.snapshotId);
		if (!snapshot) throw new ConvexError("Snapshot not found.");
		await markSnapshotDeleting(ctx, args.snapshotId);
		await ctx.scheduler.runAfter(0, internal.boxes.boxSnapshots.runDelete, {
			snapshotRowId: args.snapshotId
		});
	}
});
