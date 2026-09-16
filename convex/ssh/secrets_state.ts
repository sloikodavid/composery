import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * What an admin needs to rotate `SSH_ACCESS_ENCRYPTION_KEYS`: which key encrypted each stored
 * value, and a way to encrypt it again with the current one. Because every value names its key,
 * "is the old
 * key still needed" is a question the database answers, rather than something to hope about.
 */

const pageSize = 50;

const encryptedRow = v.object({
	id: v.id("allocationSshAccess"),
	allocationId: v.id("serverAllocations"),
	encryptedSecrets: v.string(),
	pendingEncryptedSecrets: v.union(v.string(), v.null()),
});

/** One page of stored values, oldest first, so a rotation can walk every one of them. */
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

/**
 * Replaces one row's envelopes with the same secrets under the current key. It refuses when
 * the row changed in the meantime, because a renewal writes these fields too and the secrets it
 * wrote must not be replaced by older ones.
 */
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
