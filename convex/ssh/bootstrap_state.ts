import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { isAllocationAddress } from "../allocations/addresses";
import { getAllocationSshAccess } from "./access_state";

const hexRadix = 16;

/** How long a server has to report its host key, from creation or from a renewal. */
export const bootstrapLifetimeMs = 900_000;

/** What the server reports with: the allocation it belongs to, its one-time token, and where to send it. */
export type SshBootstrapFile = {
	allocationId: string;
	token: string;
	url: string;
};

/** Only the digest is stored, so a reader of the table cannot report on a server's behalf. */
export async function toBootstrapTokenDigest(token: string) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(token),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(hexRadix).padStart(2, "0"),
	).join("");
}

/**
 * Opens one more bootstrap window, with the key pair that replaces the management key. The
 * replacement waits until the server reports with it, so an unrun renewal leaves access as it was.
 */
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

/**
 * A report inside a renewal's window proves the server holds the pending key, so that key
 * becomes the management key. Without a renewal there is nothing to promote.
 */
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

/**
 * A repeated report confirms the pinned host key. A different key replaces it only inside a new
 * bootstrap window that a member opened; otherwise it is refused and recorded as a conflict.
 */
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
		// A copied bootstrap token is useless from anywhere but the server's own addresses. An
		// unknown source or an allocation without addresses cannot be checked, so it is refused.
		const isOwnAddress =
			source === null ? null : isAllocationAddress(source, allocation);
		if (isOwnAddress !== true) {
			await ctx.db.patch("allocationSshAccess", sshAccess._id, {
				hostKeyConflictAt: Date.now(),
			});
			return false;
		}
		// A repeat of the same report changes nothing, so a retry cannot churn the stored state.
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
			// Two servers answered for one allocation: a copied bootstrap token, or a replacement.
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
		// The first sign-in after a pin both records the hostname and proves the access works.
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
