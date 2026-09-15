"use node";

import { randomBytes } from "node:crypto";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { action, env } from "../_generated/server";
import { toConvexError } from "../errors";
import { renderSshBootstrapScript } from "./bootstrap_script";
import {
	bootstrapLifetimeMs,
	type SshBootstrapFile,
	toBootstrapTokenDigest,
} from "./bootstrap_state";
import { SshAccessError } from "./errors";
import { generateSshKeyPair } from "./key_pair";
import { decryptSshSecrets, encryptSshSecrets } from "./secrets";

const bootstrapTokenBytes = 32;

type AllocationSshAccess = Doc<"allocationSshAccess">;

function generateBootstrapToken() {
	return randomBytes(bootstrapTokenBytes).toString("base64url");
}

function requireReportUrl() {
	const url = `${env.CONVEX_SITE_URL}/ssh/host-keys`;
	// The token travels in this URL's request body, so a plain HTTP report would expose it.
	if (!url.startsWith("https://")) {
		throw new SshAccessError("bootstrap_url_insecure");
	}
	return url;
}

/** Only an expired bootstrap without a registered host key needs new access. */
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

/** The file cloud-init writes, for a window that is still open. */
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

/**
 * Opens one more bootstrap window and returns the program that completes it, for a member whose
 * server no longer accepts Composery. The program must run on the server itself: the report
 * that it sends is refused from any other address. It installs a new management key, and the
 * old one keeps working until the server reports with the new one.
 */
export const renew = action({
	args: { serverId: v.id("servers") },
	returns: v.object({ script: v.string() }),
	handler: async (ctx, { serverId }): Promise<{ script: string }> => {
		const allocation: Doc<"serverAllocations"> = await ctx.runQuery(
			internal.servers.permissions.requireSshAccess,
			{ serverId },
		);
		const allocationId = allocation._id;
		const sshAccess: AllocationSshAccess | null = await ctx.runQuery(
			internal.ssh.access_state.get,
			{ allocationId },
		);
		if (sshAccess === null) {
			throw toConvexError("server_busy");
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
				bootstrapFile: {
					allocationId,
					token,
					url: requireReportUrl(),
				},
				publicKey: keyPair.publicKey,
				previousPublicKey: sshAccess.publicKey,
			}),
		};
	},
});
