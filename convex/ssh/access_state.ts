import { type Infer, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
	env,
	internalQuery,
	type MutationCtx,
	type QueryCtx,
} from "../_generated/server";
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

export const get = internalQuery({
	args: { allocationId: v.id("serverAllocations") },
	returns: v.union(schema.doc("allocationSshAccess"), v.null()),
	handler: async (ctx, { allocationId }) =>
		await getAllocationSshAccess(ctx, allocationId),
});
