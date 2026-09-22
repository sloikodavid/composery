import { type Infer, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
	env,
	internalQuery,
	type MutationCtx,
	type QueryCtx,
} from "../_generated/server";
import { allocationPartStatus } from "../allocations/schema";
import { internalMutation } from "../functions";
import schema from "../schema";
import { isSshAccessConfigured as isConfigured } from "./encryption_keys";
import type { sshTables } from "./schema";

type AllocationSshAccessFields = Infer<
	typeof sshTables.allocationSshAccess.validator
>;

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

export async function storeAllocationSshAccess(
	ctx: MutationCtx,
	fields: AllocationSshAccessFields,
) {
	// Only pending servers can still receive this public key through cloud-init.
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

const checkEveryMs = 21_600_000;
// The sweep handles 20 checks per minute, oldest first.
const checkBatchSize = 20;

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
