import { defineTable } from "convex/server";
import { v } from "convex/values";

export const sshTables = {
	allocationSshAccess: defineTable({
		allocationId: v.id("serverAllocations"),
		publicKey: v.string(),
		encryptedSecrets: v.string(),
		pendingPublicKey: v.optional(v.string()),
		pendingEncryptedSecrets: v.optional(v.string()),
		bootstrapTokenDigest: v.string(),
		bootstrapExpiresAt: v.number(),
		hostKey: v.optional(v.string()),
		hostKeySource: v.optional(v.string()),
		hostKeyConflictAt: v.optional(v.number()),
		hostKeyReplaceUntil: v.optional(v.number()),
		port: v.optional(v.number()),
	}).index("by_allocation_id", ["allocationId"]),
};
