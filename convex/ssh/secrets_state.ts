import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

const pageSize = 50;

// Rows are read oldest first so a rotation can cover the full table.

const encryptedRow = v.object({
	id: v.id("allocationSshAccess"),
	allocationId: v.id("serverAllocations"),
	encryptedSecrets: v.string(),
	pendingEncryptedSecrets: v.union(v.string(), v.null()),
});

export const listEncrypted = internalQuery({
	args: { cursor: v.union(v.string(), v.null()) },
	returns: v.object({
		page: v.array(encryptedRow),
		isDone: v.boolean(),
		continueCursor: v.string(),
	}),
	handler: async (ctx, args) => {
		const result = await ctx.db
			.query("allocationSshAccess")
			.paginate({ numItems: pageSize, cursor: args.cursor });
		return {
			page: result.page.map((row) => ({
				id: row._id,
				allocationId: row.allocationId,
				encryptedSecrets: row.encryptedSecrets,
				pendingEncryptedSecrets: row.pendingEncryptedSecrets ?? null,
			})),
			isDone: result.isDone,
			continueCursor: result.continueCursor,
		};
	},
});

export const storeReEncrypted = internalMutation({
	args: {
		id: v.id("allocationSshAccess"),
		encryptedSecrets: v.string(),
		pendingEncryptedSecrets: v.union(v.string(), v.null()),
		expected: v.object({
			encryptedSecrets: v.string(),
			pendingEncryptedSecrets: v.union(v.string(), v.null()),
		}),
	},
	returns: v.union(
		v.literal("stored"),
		v.literal("changed"),
		v.literal("gone"),
	),
	handler: async (ctx, args) => {
		// The expected envelope prevents overwriting a newer renewal.
		const row = await ctx.db.get("allocationSshAccess", args.id);
		if (row === null) {
			return "gone";
		}
		if (
			row.encryptedSecrets !== args.expected.encryptedSecrets ||
			(row.pendingEncryptedSecrets ?? null) !==
				args.expected.pendingEncryptedSecrets
		) {
			return "changed";
		}
		await ctx.db.patch("allocationSshAccess", args.id, {
			encryptedSecrets: args.encryptedSecrets,
			...(args.pendingEncryptedSecrets === null
				? {}
				: { pendingEncryptedSecrets: args.pendingEncryptedSecrets }),
		});
		return "stored";
	},
});
