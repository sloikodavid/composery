import { ConvexError, type Infer, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	type MutationCtx,
	type QueryCtx,
} from "../_generated/server";
import schema from "../schema";
import type { sshTables } from "./schema";

// Base64 of exactly 32 bytes.
const credentialKeyPattern = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;

type AllocationSshAccessFields = Infer<
	typeof sshTables.allocationSshAccess.validator
>;

export function requireSshCredentialKeyFormat(value: string) {
	if (!credentialKeyPattern.test(value)) {
		throw new ConvexError({ message: "The SSH credential key is invalid." });
	}
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
 * Keeps access that cloud-init can already hold. Replaces only an expired
 * bootstrap whose host key was never registered. The caller must confirm that
 * the server was not requested yet.
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

// A duplicate registration can confirm the pinned host key but never replace it.
export const registerHostKey = internalMutation({
	args: {
		allocationId: v.id("serverAllocations"),
		bootstrapTokenDigest: v.string(),
		hostKey: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, { allocationId, bootstrapTokenDigest, hostKey }) => {
		const allocation = await ctx.db.get("serverAllocations", allocationId);
		const sshAccess = await getAllocationSshAccess(ctx, allocationId);
		if (
			allocation === null ||
			allocation.deleteRequested ||
			sshAccess === null ||
			sshAccess.bootstrapExpiresAt <= Date.now() ||
			sshAccess.bootstrapTokenDigest !== bootstrapTokenDigest
		) {
			return false;
		}
		if (sshAccess.hostKey !== undefined) {
			return sshAccess.hostKey === hostKey;
		}
		await ctx.db.patch("allocationSshAccess", sshAccess._id, { hostKey });
		return true;
	},
});
