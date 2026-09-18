"use node";

import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { AllocationPartState } from "../allocations/schema";
import type { SshConnectionOptions } from "./connection";
import { SshAccessError, SshError, type SshFailure } from "./errors";
import { decryptSshSecrets } from "./secrets";

const sshPort = 22;
const connectionTimeoutMs = 30_000;

/**
 * What one attempt to sign in says about Composery's own way in. A server that did not accept our
 * key is not the same as one nobody could reach, and neither means the server is unwell.
 */
// biome-ignore-start lint/style/useNamingConvention: failure codes use snake_case
const accessStates = {
	host_key_mismatch: "mismatch",
	authentication_failed: "missing",
	permission_denied: "missing",
} as const satisfies Partial<Record<SshFailure, AllocationPartState>>;
// biome-ignore-end lint/style/useNamingConvention: failure codes use snake_case

function toAccessState(error: unknown): AllocationPartState {
	if (error instanceof SshError) {
		// Anything else stopped the attempt without saying anything about the way in.
		return accessStates[error.code as keyof typeof accessStates] ?? "unknown";
	}
	return error instanceof SshAccessError ? "missing" : "unknown";
}

/**
 * How Composery signs in to one allocation: its own management key, and the host key that the
 * server reported once. Without that pinned host key there is nothing to check the server
 * against, so no connection is made.
 */
/**
 * Runs one thing over Composery's own way in, and writes down what the attempt found. Nothing
 * looks for trouble on its own: this is what every real use of that way in already is, so the
 * panel says what the last one found rather than what a prober guessed.
 */
export async function withSshConnection<Result>(
	ctx: ActionCtx,
	allocation: Doc<"serverAllocations">,
	run: (connection: SshConnectionOptions) => Promise<Result>,
): Promise<Result> {
	try {
		const result = await run(await requireSshConnection(ctx, allocation));
		await recordAccess(ctx, allocation, "ok");
		return result;
	} catch (error) {
		await recordAccess(ctx, allocation, toAccessState(error));
		throw error;
	}
}

async function recordAccess(
	ctx: ActionCtx,
	allocation: Doc<"serverAllocations">,
	state: AllocationPartState,
) {
	await ctx.runMutation(internal.ssh.access_state.recordAccess, {
		allocationId: allocation._id,
		state,
	});
}

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
