"use node";

import { randomBytes } from "node:crypto";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
	type ActionCtx,
	action,
	env,
	internalAction,
} from "../_generated/server";
import { toConvexError } from "../errors";
import { isLoopbackHost } from "../loopback";
import {
	bootstrapLifetimeMs,
	type SshBootstrapFile,
	toBootstrapTokenDigest,
} from "./bootstrap_state";
import { SshAccessError } from "./errors";
import { generateSshKeyPair } from "./key_pair";
import { renderSshBootstrapScript } from "./scripts/bootstrap";
import { decryptSshSecrets, encryptSshSecrets } from "./secrets";

const bootstrapTokenBytes = 32;

type AllocationSshAccess = Doc<"allocationSshAccess">;

function generateBootstrapToken() {
	return randomBytes(bootstrapTokenBytes).toString("base64url");
}

/** The token-bearing report must use HTTPS or loopback. */
function requireReportUrl() {
	const site = env.CONVEX_SITE_URL;
	let url: URL;
	try {
		url = new URL(site);
	} catch {
		throw new SshAccessError("bootstrap_url_insecure");
	}
	if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
		throw new SshAccessError("bootstrap_url_insecure");
	}
	return `${site}/ssh/host-keys`;
}

/** Reuses access only while the host key is pinned and the bootstrap is open. */
export function canReuseAllocationSshAccess(
	sshAccess: AllocationSshAccess | null,
) {
	return (
		sshAccess !== null &&
		(sshAccess.bootstrapExpiresAt > Date.now() ||
			sshAccess.hostKey !== undefined)
	);
}

export async function generateAllocationSshAccess(
	allocationId: Id<"serverAllocations">,
) {
	const keyPair = generateSshKeyPair();
	const token = generateBootstrapToken();
	return {
		allocationId,
		publicKey: keyPair.publicKey,
		encryptedSecrets: encryptSshSecrets(allocationId, {
			privateKey: keyPair.privateKey,
			token,
		}),
		bootstrapTokenDigest: await toBootstrapTokenDigest(token),
		bootstrapExpiresAt: Date.now() + bootstrapLifetimeMs,
	};
}

export function requireSshBootstrapFile(
	sshAccess: AllocationSshAccess,
): SshBootstrapFile {
	if (sshAccess.bootstrapExpiresAt <= Date.now()) {
		throw new SshAccessError("bootstrap_expired");
	}
	return {
		allocationId: sshAccess.allocationId,
		token: decryptSshSecrets(sshAccess.allocationId, sshAccess.encryptedSecrets)
			.token,
		url: requireReportUrl(),
	};
}

/** Keeps the old key until the server reports with the replacement key. */
async function renewSshAccess(
	ctx: ActionCtx,
	allocationId: Id<"serverAllocations">,
): Promise<{ script: string }> {
	const sshAccess: AllocationSshAccess | null = await ctx.runQuery(
		internal.ssh.access_state.get,
		{ allocationId },
	);
	if (sshAccess === null) {
		throw toConvexError("server_busy");
	}
	const url = requireReportUrl();
	if (
		sshAccess.pendingPublicKey !== undefined &&
		sshAccess.pendingEncryptedSecrets !== undefined &&
		sshAccess.bootstrapExpiresAt > Date.now()
	) {
		return {
			script: renderSshBootstrapScript({
				bootstrapFile: {
					allocationId,
					token: decryptSshSecrets(
						allocationId,
						sshAccess.pendingEncryptedSecrets,
					).token,
					url,
				},
				publicKey: sshAccess.pendingPublicKey,
				previousPublicKey: sshAccess.publicKey,
			}),
		};
	}
	const keyPair = generateSshKeyPair();
	const token = generateBootstrapToken();
	await ctx.runMutation(internal.ssh.bootstrap_state.storeRenewal, {
		allocationId,
		pendingPublicKey: keyPair.publicKey,
		pendingEncryptedSecrets: encryptSshSecrets(allocationId, {
			privateKey: keyPair.privateKey,
			token,
		}),
		bootstrapTokenDigest: await toBootstrapTokenDigest(token),
	});
	return {
		script: renderSshBootstrapScript({
			bootstrapFile: { allocationId, token, url },
			publicKey: keyPair.publicKey,
			previousPublicKey: sshAccess.publicKey,
		}),
	};
}

export const renew = action({
	args: { serverId: v.id("servers") },
	returns: v.object({ script: v.string() }),
	handler: async (ctx, { serverId }): Promise<{ script: string }> => {
		const allocation: Doc<"serverAllocations"> = await ctx.runQuery(
			internal.ssh.permissions.requireAllocation,
			{ serverId },
		);
		return await renewSshAccess(ctx, allocation._id);
	},
});

export const renewForAdmin = internalAction({
	args: { serverId: v.id("servers") },
	returns: v.object({ script: v.string() }),
	handler: async (ctx, { serverId }): Promise<{ script: string }> => {
		const allocation: Doc<"serverAllocations"> | null = await ctx.runQuery(
			internal.allocations.operations.getForServer,
			{ serverId },
		);
		if (allocation === null) {
			throw new Error("That server has no allocation.");
		}
		return await renewSshAccess(ctx, allocation._id);
	},
});
