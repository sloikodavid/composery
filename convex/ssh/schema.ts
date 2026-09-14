import { defineTable } from "convex/server";
import { v } from "convex/values";

export const sshTables = {
	// The backend's management access to one allocation. The server generates its own host key and registers it.
	allocationSshAccess: defineTable({
		allocationId: v.id("serverAllocations"),
		publicKey: v.string(),
		encryptedCredential: v.string(),
		bootstrapTokenDigest: v.string(),
		bootstrapExpiresAt: v.number(),
		hostKey: v.optional(v.string()),
	}).index("by_allocation_id", ["allocationId"]),
};
