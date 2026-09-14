import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import schema from "../schema";

export const get = internalQuery({
	args: { allocationId: v.id("serverAllocations") },
	returns: v.union(schema.doc("serverSshAccess"), v.null()),
	handler: async (ctx, { allocationId }) =>
		await ctx.db
			.query("serverSshAccess")
			.withIndex("by_allocation_id", (q) => q.eq("allocationId", allocationId))
			.unique(),
});

export const prepare = internalMutation({
	args: schema.tables.serverSshAccess.validator.fields,
	returns: schema.doc("serverSshAccess"),
	handler: async (ctx, input) => {
		const allocation = await ctx.db.get(
			"serverAllocations",
			input.allocationId,
		);
		if (
			!allocation ||
			allocation.deleteRequested ||
			allocation.resources.server.phase !== "pending"
		)
			throw new Error("ssh_bootstrap_not_pending");
		const existing = await ctx.db
			.query("serverSshAccess")
			.withIndex("by_allocation_id", (q) =>
				q.eq("allocationId", input.allocationId),
			)
			.unique();
		if (existing) {
			if (existing.bootstrapExpiresAt > Date.now() || existing.hostKey)
				return existing;
			await ctx.db.replace("serverSshAccess", existing._id, input);
			return {
				...input,
				_id: existing._id,
				_creationTime: existing._creationTime,
			};
		}
		const id = await ctx.db.insert("serverSshAccess", input);
		const stored = await ctx.db.get("serverSshAccess", id);
		if (!stored) throw new Error("ssh_bootstrap_missing");
		return stored;
	},
});

export const acceptHostKey = internalMutation({
	args: {
		allocationId: v.id("serverAllocations"),
		digest: v.string(),
		hostKey: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, { allocationId, digest, hostKey }) => {
		const allocation = await ctx.db.get("serverAllocations", allocationId);
		const access = await ctx.db
			.query("serverSshAccess")
			.withIndex("by_allocation_id", (q) => q.eq("allocationId", allocationId))
			.unique();
		if (
			!allocation ||
			allocation.deleteRequested ||
			!access ||
			access.bootstrapExpiresAt <= Date.now() ||
			access.bootstrapDigest !== digest ||
			allocation.resources.server.phase === "absent"
		)
			return false;
		if (access.hostKey) return access.hostKey === hostKey;
		await ctx.db.patch("serverSshAccess", access._id, { hostKey });
		return true;
	},
});
