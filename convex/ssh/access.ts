"use node";

import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { SshConnectionOptions } from "./connection";
import { SshAccessError } from "./errors";
import { decryptSshSecrets } from "./secrets";

const sshPort = 22;
const connectionTimeoutMs = 30_000;

/**
 * How Composery signs in to one allocation: its own management key, and the host key that the
 * server reported once. Without that pinned host key there is nothing to check the server
 * against, so no connection is made.
 */
export async function requireSshConnection(
	ctx: ActionCtx,
	allocation: Doc<"serverAllocations">,
): Promise<SshConnectionOptions> {
	if (allocation.deleteRequested || allocation.ipv4 === undefined) {
		throw new SshAccessError("allocation_unavailable");
	}
	const sshAccess: Doc<"allocationSshAccess"> | null = await ctx.runQuery(
		internal.ssh.access_state.get,
		{ allocationId: allocation._id },
	);
	if (sshAccess?.hostKey === undefined) {
		throw new SshAccessError("host_key_missing");
	}
	return {
		address: allocation.ipv4,
		port: sshAccess.port ?? sshPort,
		username: "root",
		privateKey: decryptSshSecrets(
			sshAccess.allocationId,
			sshAccess.encryptedSecrets,
		).privateKey,
		hostKey: Buffer.from(sshAccess.hostKey.split(" ")[1] ?? "", "base64"),
		timeoutMs: connectionTimeoutMs,
	};
}
