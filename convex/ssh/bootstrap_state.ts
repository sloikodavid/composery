import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { isAllocationAddress } from "../allocations/addresses";
import { storeReportedAddress } from "../allocations/operations";
import { getAllocationSshAccess } from "./access_state";

const hexRadix = 16;

/** Host-key reports are accepted for 15 minutes after creation or renewal. */
export const bootstrapLifetimeMs = 900_000;

export type SshBootstrapFile = {
	allocationId: string;
	token: string;
	url: string;
};

/** Store only the digest so a database reader cannot authenticate a report. */
export async function toBootstrapTokenDigest(token: string) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(token),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(hexRadix).padStart(2, "0"),
	).join("");
}

export const storeRenewal = internalMutation({
	args: {
		allocationId: v.id("serverAllocations"),
		pendingPublicKey: v.string(),
		pendingEncryptedSecrets: v.string(),
		bootstrapTokenDigest: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, { allocationId, ...renewal }) => {
		const sshAccess = await getAllocationSshAccess(ctx, allocationId);
		if (sshAccess === null) {
			throw new Error("The allocation has no SSH access.");
		}
		const until = Date.now() + bootstrapLifetimeMs;
		await ctx.db.patch("allocationSshAccess", sshAccess._id, {
			...renewal,
			bootstrapExpiresAt: until,
			hostKeyReplaceUntil: until,
		});
		return null;
	},
});

/** A report with the pending key promotes it to management access. */
function toPendingPromotion(sshAccess: Doc<"allocationSshAccess">) {
	if (
		sshAccess.pendingPublicKey === undefined ||
		sshAccess.pendingEncryptedSecrets === undefined
	) {
		return {};
	}
	return {
		publicKey: sshAccess.pendingPublicKey,
		encryptedSecrets: sshAccess.pendingEncryptedSecrets,
		pendingPublicKey: undefined,
		pendingEncryptedSecrets: undefined,
	};
}

export const registerHostKey = internalMutation({
	args: {
		allocationId: v.string(),
		bootstrapTokenDigest: v.string(),
		hostKey: v.string(),
		port: v.union(v.number(), v.null()),
		source: v.union(v.string(), v.null()),
	},
	returns: v.boolean(),
	handler: async (
		ctx,
		{ allocationId, bootstrapTokenDigest, hostKey, port, source },
	) => {
		const id = ctx.db.normalizeId("serverAllocations", allocationId);
		const allocation =
			id === null ? null : await ctx.db.get("serverAllocations", id);
		const sshAccess =
			id === null ? null : await getAllocationSshAccess(ctx, id);
		if (
			allocation === null ||
			allocation.deleteRequested ||
			sshAccess === null ||
			sshAccess.bootstrapExpiresAt <= Date.now() ||
			sshAccess.bootstrapTokenDigest !== bootstrapTokenDigest
		) {
			return false;
		}
		const isOwnAddress =
			source === null ? null : isAllocationAddress(source, allocation);
		if (isOwnAddress !== true) {
			await ctx.db.patch("allocationSshAccess", sshAccess._id, {
				hostKeyConflictAt: Date.now(),
			});
			return false;
		}
		if (
			sshAccess.hostKey === hostKey &&
			sshAccess.hostKeyReplaceUntil === undefined &&
			sshAccess.pendingPublicKey === undefined
		) {
			return true;
		}
		const isBootstrapOpen = (sshAccess.hostKeyReplaceUntil ?? 0) > Date.now();
		if (
			sshAccess.hostKey !== undefined &&
			sshAccess.hostKey !== hostKey &&
			!isBootstrapOpen
		) {
			await ctx.db.patch("allocationSshAccess", sshAccess._id, {
				hostKeyConflictAt: Date.now(),
			});
			return false;
		}
		await ctx.db.patch("allocationSshAccess", sshAccess._id, {
			...toPendingPromotion(sshAccess),
			hostKey,
			hostKeyConflictAt: undefined,
			hostKeyReplaceUntil: undefined,
			...(source === null ? {} : { hostKeySource: source }),
			...(port === null ? {} : { port }),
		});
		if (source !== null) {
			await storeReportedAddress(ctx, allocation, source);
		}
		const server = await ctx.db.get("servers", allocation.serverId);
		if (server !== null) {
			await ctx.scheduler.runAfter(0, internal.ssh.hostname.apply, {
				serverId: server._id,
				expected: server.name,
				next: server.name,
				attempt: 0,
			});
		}
		return true;
	},
});
