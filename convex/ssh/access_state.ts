import { type Infer, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
	env,
	internalMutation,
	internalQuery,
	type MutationCtx,
	type QueryCtx,
} from "../_generated/server";
import { allocationPartStatus } from "../allocations/schema";
import schema from "../schema";
import { isSshAccessConfigured as isConfigured } from "./encryption_keys";
import type { sshTables } from "./schema";

type AllocationSshAccessFields = Infer<
	typeof sshTables.allocationSshAccess.validator
>;

/** Throws when the keys are set but any of them is not one. */
export function isSshAccessConfigured() {
	return isConfigured(env.SSH_ACCESS_ENCRYPTION_KEYS);
}

export async function getAllocationSshAccess(
	ctx: QueryCtx,
	allocationId: Id<"serverAllocations">,
) {
	return await ctx.db
		.query("allocationSshAccess")
		.withIndex("by_allocation_id", (q) => q.eq("allocationId", allocationId))
		.unique();
}

export async function deleteAllocationSshAccess(
	ctx: MutationCtx,
	allocationId: Id<"serverAllocations">,
) {
	const sshAccess = await getAllocationSshAccess(ctx, allocationId);
	if (sshAccess !== null) {
		await ctx.db.delete("allocationSshAccess", sshAccess._id);
	}
}

/**
 * Keeps access that cloud-init can already hold, and replaces only an expired
 * bootstrap without a registered host key. The caller must confirm that the
 * server was not requested yet.
 */
export async function storeAllocationSshAccess(
	ctx: MutationCtx,
	fields: AllocationSshAccessFields,
) {
	const existing = await getAllocationSshAccess(ctx, fields.allocationId);
	if (existing === null) {
		const id = await ctx.db.insert("allocationSshAccess", fields);
		const inserted = await ctx.db.get("allocationSshAccess", id);
		if (inserted === null) {
			throw new Error("The SSH access that was inserted is missing.");
		}
		return inserted;
	}
	if (
		existing.bootstrapExpiresAt > Date.now() ||
		existing.hostKey !== undefined
	) {
		return existing;
	}
	await ctx.db.replace("allocationSshAccess", existing._id, fields);
	return {
		...fields,
		_id: existing._id,
		_creationTime: existing._creationTime,
	};
}

/** Writes down what the last attempt to sign in found, for whoever reads the server's state. */
export const recordAccess = internalMutation({
	args: {
		allocationId: v.id("serverAllocations"),
		status: allocationPartStatus,
	},
	returns: v.null(),
	handler: async (ctx, { allocationId, status }) => {
		const sshAccess = await getAllocationSshAccess(ctx, allocationId);
		if (sshAccess !== null) {
			await ctx.db.patch("allocationSshAccess", sshAccess._id, {
				access: { status, at: Date.now() },
			});
		}
		return null;
	},
});

export const get = internalQuery({
	args: { allocationId: v.id("serverAllocations") },
	returns: v.union(schema.doc("allocationSshAccess"), v.null()),
	handler: async (ctx, { allocationId }) =>
		await getAllocationSshAccess(ctx, allocationId),
});

/** How long a server's way in may go unlooked-at before it is looked at again. */
const checkEveryMs = 21_600_000;
// Enough that a large fleet comes round inside the interval, and small enough that a minute of
// checks is a minute of ordinary connections.
const checkBatchSize = 5;

/**
 * Hands the oldest looks to the check, and a row nobody has looked at first of all. Each one is
 * stamped by what the check finds, so the queue always moves: a server that cannot answer says
 * so and goes to the back, rather than holding the front for everyone behind it.
 */
export const sweep = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const due = await ctx.db
			.query("allocationSshAccess")
			.withIndex("by_access_at", (q) =>
				q.lt("access.at", Date.now() - checkEveryMs),
			)
			.take(checkBatchSize);
		for (const sshAccess of due) {
			await ctx.scheduler.runAfter(0, internal.ssh.access.check, {
				allocationId: sshAccess.allocationId,
			});
		}
		return null;
	},
});
