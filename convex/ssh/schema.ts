import { defineTable } from "convex/server";
import { v } from "convex/values";

export const sshTables = {
	allocationSshAccess: defineTable({
		allocationId: v.id("serverAllocations"),
		publicKey: v.string(),
		encryptedSecrets: v.string(),
		bootstrapTokenDigest: v.string(),
		bootstrapExpiresAt: v.number(),
		hostKey: v.optional(v.string()),
	}).index("by_allocation_id", ["allocationId"]),
};
