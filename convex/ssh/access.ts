"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { type ActionCtx, internalAction } from "../_generated/server";
import type { AllocationPartStatus } from "../allocations/schema";
import {
	runSshCommand,
	type SshConnectionOptions,
	toSshProgramCommand,
} from "./connection";
import { SshAccessError, SshError, type SshFailure } from "./errors";
import { addressesScript } from "./scripts/addresses";
import { decryptSshSecrets } from "./secrets";

const sshPort = 22;
const connectionTimeoutMs = 30_000;
const maxAddressBytes = 4096;
const maxAddresses = 8;

/**
 * What one attempt to sign in says about Composery's own way in. A server that did not accept our
 * key is not the same as one nobody could reach, and neither means the server is unwell.
 */
// biome-ignore-start lint/style/useNamingConvention: failure codes use snake_case
const accessStatuses = {
	host_key_mismatch: "mismatch",
	authentication_failed: "missing",
	permission_denied: "missing",
} as const satisfies Partial<Record<SshFailure, AllocationPartStatus>>;
// biome-ignore-end lint/style/useNamingConvention: failure codes use snake_case

export function toAccessStatus(error: unknown): AllocationPartStatus {
	if (error instanceof SshError) {
		// Anything else stopped the attempt without saying anything about the way in.
		return (
			accessStatuses[error.code as keyof typeof accessStatuses] ?? "unknown"
		);
	}
	// Every one of these stopped before the server was asked anything: a host key that was never
	// reported, a key of ours that cannot be read, an allocation on its way out. None of them is
	// the server refusing us, and saying the key is gone would name the wrong thing as broken.
	return "unknown";
}

/**
 * Runs one thing over Composery's own way in, and writes down what the attempt found. Every real
 * use of that way in passes through here, and so does the check that runs on a schedule, so the
 * panel says what the last attempt found whether or not anybody asked for one.
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
		await recordAccess(ctx, allocation, toAccessStatus(error));
		throw error;
	}
}

async function recordAccess(
	ctx: ActionCtx,
	allocation: Doc<"serverAllocations">,
	status: AllocationPartStatus,
) {
	await ctx.runMutation(internal.ssh.access_state.recordAccess, {
		allocationId: allocation._id,
		status,
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

/** What a server says it answers on, which is the only place that knows. */
function toReportedAddresses(stdout: string): string[] {
	const reported: unknown = JSON.parse(stdout);
	const addresses =
		typeof reported === "object" && reported !== null && "ipv6" in reported
			? reported.ipv6
			: null;
	if (!Array.isArray(addresses)) {
		throw new SshError("invalid_response");
	}
	return addresses
		.filter((address): address is string => typeof address === "string")
		.slice(0, maxAddresses);
}

/**
 * Looks at Composery's own way in to one server, and at what only the server can say. A customer
 * who never opens the SSH features would otherwise learn that our key is gone at the moment they
 * first need it, and the address a client connects to would stay unknown for any server that
 * reported its host key over IPv4.
 *
 * A server that cannot answer is not a server that refused us: everything but a refusal is
 * recorded as unknown, which is what `withSshConnection` already decides for every other caller.
 */
export const check = internalAction({
	args: { allocationId: v.id("serverAllocations") },
	returns: v.null(),
	handler: async (ctx, { allocationId }) => {
		const allocation: Doc<"serverAllocations"> | null = await ctx.runQuery(
			internal.allocations.operations.get,
			{ allocationId },
		);
		if (allocation === null) {
			return null;
		}
		if (allocation.status !== "running" || allocation.deleteRequested) {
			// A server that is not running cannot answer, and saying so is the honest answer.
			await ctx.runMutation(internal.ssh.access_state.recordAccess, {
				allocationId,
				status: "unknown",
			});
			return null;
		}
		try {
			const result = await withSshConnection(
				ctx,
				allocation,
				async (connection) =>
					await runSshCommand(
						connection,
						toSshProgramCommand(addressesScript),
						{ maxOutputBytes: maxAddressBytes },
					),
			);
			await ctx.runMutation(
				internal.allocations.operations.recordReportedAddress,
				{ allocationId, addresses: toReportedAddresses(result.stdout) },
			);
		} catch {
			// What the attempt found is already written down, and nothing else is owed.
		}
		return null;
	},
});
