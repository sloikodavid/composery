import { ConvexError, v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { action, mutation, query, type QueryCtx } from "../_generated/server";
import {
	getUserByClerkId,
	publicUser,
	requireStaff,
	requireStaffInAction
} from "../authorization";
import { fetchRuntimeLogsSafely } from "../boxes/boxLogs";
import { startBoxOperation, startBoxSuspension } from "../boxes/boxOperations";
import { hashBoxPassword } from "../boxes/boxPassword";
import { findBoxBySlug, latestSuspensionReason } from "../boxes/boxQueries";
import { staffBox } from "../boxes/boxViews";
import {
	markSnapshotDeleting,
	snapshotView,
	startManualSnapshot
} from "../boxes/boxSnapshots";
import { isValidSlug, sanitizeSlug } from "../../lib/box-slug";

const STAFF_BOX_LIST_LIMIT = 50;
const STAFF_BOX_SEARCH_SCAN_LIMIT = 500;
const STAFF_BOX_DETAIL_HISTORY_LIMIT = 100;

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
		box.slug.includes(term) ||
		box.user_id.toLowerCase().includes(term) ||
		(user?.email ?? "").toLowerCase().includes(term) ||
		box.polar_subscription_id.toLowerCase().includes(term)
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
		await requireStaff(ctx);
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
			const slug = sanitizeSlug(rawTerm);
			if (isValidSlug(slug)) {
				addBoxCandidate(candidates, await findBoxBySlug(ctx, slug));
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

export const boxDetail = query({
	args: {
		slug: v.string()
	},
	handler: async (ctx, args) => {
		await requireStaff(ctx);
		const box = await findBoxBySlug(ctx, args.slug);
		if (!box) return null;

		const user = await getUserByClerkId(ctx, box.user_id);
		const operations = await ctx.db
			.query("box_operations")
			.withIndex("box_id", (builder) => builder.eq("box_id", box._id))
			.order("desc")
			.take(STAFF_BOX_DETAIL_HISTORY_LIMIT);
		const events = await ctx.db
			.query("box_events")
			.withIndex("box_id_created_at", (builder) =>
				builder.eq("box_id", box._id)
			)
			.order("desc")
			.take(STAFF_BOX_DETAIL_HISTORY_LIMIT);
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
			box: staffBox(box, user),
			user: user ? publicUser(user) : null,
			operations,
			events,
			subscription,
			suspendedReason
		};
	}
});

export const retryProvisionBox = mutation({
	args: {
		boxId: v.id("boxes")
	},
	handler: async (ctx, args) => {
		await requireStaff(ctx);
		await startBoxOperation(ctx, args.boxId, "provision", {
			idempotencyKey: `staff-provision:${args.boxId}`
		});
	}
});

export const resetBox = mutation({
	args: {
		boxId: v.id("boxes")
	},
	handler: async (ctx, args) => {
		await requireStaff(ctx);
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
		await requireStaff(ctx);
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
		await requireStaff(ctx);
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
		await requireStaff(ctx);
		await startBoxOperation(ctx, args.boxId, "start", {
			idempotencyKey: `staff-start:${args.boxId}`
		});
	}
});

export const changeBoxPassword = action({
	args: {
		boxId: v.id("boxes"),
		password: v.string()
	},
	handler: async (ctx, args) => {
		await requireStaffInAction(ctx);

		const runtimeAuthHash = await hashBoxPassword(args.password);
		const operationId = await startBoxOperation(
			ctx,
			args.boxId,
			"change_password",
			{
				idempotencyKey: `staff-change-password:${args.boxId}`,
				workflowArgs: { runtimeAuthHash }
			}
		);
		if (!operationId)
			throw new ConvexError("Password change is already in progress.");
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
		await requireStaffInAction(ctx);

		const box = await ctx.runQuery(internal.boxes.boxQueries.boxBySlug, {
			slug: sanitizeSlug(args.slug)
		});
		if (!box) throw new ConvexError("Box not found.");
		if (box.status !== "running") return { logs: null };

		return await fetchRuntimeLogsSafely(ctx, box._id);
	}
});

export const suspendBox = action({
	args: {
		boxId: v.id("boxes"),
		reason: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await requireStaffInAction(ctx);
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
		await requireStaffInAction(ctx);
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
		await requireStaff(ctx);
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
		await requireStaff(ctx);
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
		await requireStaff(ctx);
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
		await requireStaff(ctx);
		const snapshot = await ctx.db.get(args.snapshotId);
		if (!snapshot) throw new ConvexError("Snapshot not found.");
		await markSnapshotDeleting(ctx, args.snapshotId);
		await ctx.scheduler.runAfter(0, internal.boxes.boxSnapshots.runDelete, {
			snapshotRowId: args.snapshotId
		});
	}
});
