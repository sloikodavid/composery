"use node";

import { randomBytes } from "node:crypto";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { action, env } from "../_generated/server";
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

/**
 * Where a server sends its report. The token travels in the request body, so the report must be
 * encrypted on its way: HTTPS, or a loopback address, which never leaves the machine that sends it.
 */
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
			internal.ssh.permissions.requireAllocation,
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
		// A renewal that is already open is handed back as it is. The program carries a token that
		// only works until the window closes, and minting a second one would make the first useless:
		// a member who lost the reply, or ran it already, would be left with a script the server now
		// refuses. Asking again buys no more time either, because the window is from when it opened.
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
						url: requireReportUrl(),
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
