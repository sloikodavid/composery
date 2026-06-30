import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { action, internalMutation, internalQuery } from "../_generated/server";
import {
	getUserByClerkId,
	isStaffUser,
	requireStaffInAction
} from "../authorization";
import { startBoxSuspension } from "../boxes/boxOperations";

const USER_BOX_ACTION_FAILURE_EXAMPLES = 5;

export const staffUserByClerkId = internalQuery({
	args: {
		clerkUserId: v.string()
	},
	handler: async (ctx, args) => {
		const user = await getUserByClerkId(ctx, args.clerkUserId);
		return isStaffUser(user) ? user : null;
	}
});

export const setUserSuspension = internalMutation({
	args: {
		callerClerkUserId: v.string(),
		clerkUserId: v.string(),
		reason: v.optional(v.string()),
		suspended: v.boolean()
	},
	handler: async (ctx, args) => {
		const user = await ctx.db
			.query("users")
			.withIndex("clerk_user_id", (query) =>
				query.eq("clerk_user_id", args.clerkUserId)
			)
			.first();

		if (!user) throw new ConvexError("User not found.");

		// Suspension moderates customers, not staff. Blocking it stops a self-
		// lockout and one admin disabling another.
		if (args.suspended) {
			if (user.clerk_user_id === args.callerClerkUserId) {
				throw new ConvexError("You cannot suspend your own account.");
			}
			if (user.role !== "user") {
				throw new ConvexError("Staff accounts cannot be suspended.");
			}
		}

		await ctx.db.patch(user._id, {
			suspended: args.suspended,
			suspended_reason: args.suspended ? args.reason : undefined,
			suspended_at: args.suspended ? Date.now() : undefined,
			updated_at: Date.now()
		});
	}
});

export const setUserSuspended = action({
	args: {
		clerkUserId: v.string(),
		reason: v.optional(v.string()),
		suspended: v.boolean()
	},
	handler: async (ctx, args) => {
		const staffUser = await requireStaffInAction(ctx);
		await ctx.runMutation(internal.staff.users.setUserSuspension, {
			callerClerkUserId: staffUser.clerk_user_id,
			clerkUserId: args.clerkUserId,
			reason: args.reason,
			suspended: args.suspended
		});

		const failures: string[] = [];
		let failureCount = 0;
		let cursor: string | null = null;
		const status = args.suspended ? "running" : "suspended";

		for (;;) {
			const page: {
				continueCursor: string;
				isDone: boolean;
				page: Doc<"boxes">[];
			} = await ctx.runQuery(internal.boxes.boxQueries.boxesForUserStatusPage, {
				clerkUserId: args.clerkUserId,
				cursor,
				status
			});

			for (const box of page.page) {
				await startBoxSuspension(ctx, {
					boxId: box._id,
					idempotencyKeyPrefix: args.suspended
						? "user-suspend"
						: "user-unsuspend",
					reason: args.suspended ? args.reason : undefined,
					suspend: args.suspended
				}).catch((error) => {
					failureCount += 1;
					if (failures.length < USER_BOX_ACTION_FAILURE_EXAMPLES) {
						failures.push(
							`${box.slug}: ${error instanceof Error ? error.message : String(error)}`
						);
					}
				});
			}

			if (page.isDone) break;
			cursor = page.continueCursor;
		}

		if (failureCount > 0) {
			const omitted = failureCount - failures.length;
			throw new ConvexError(
				`User suspension updated, but ${failureCount} box action(s) failed: ${failures.join("; ")}${omitted > 0 ? `; ${omitted} more` : ""}`
			);
		}
	}
});
