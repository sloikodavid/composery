"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { type ActionCtx, internalAction } from "../_generated/server";
import type { AllocationPartStatus } from "../allocations/schema";
import { isAllocationDeleting } from "../allocations/schema";
import {
	runSshCommand,
	type SshConnection,
	type SshConnectionOptions,
	toSshAccessStatus,
	toSshProgramCommand,
	withSshConnection,
} from "./connection";
import { SshAccessError, SshError } from "./errors";
import { addressesScript } from "./scripts/addresses";
import { decryptSshSecrets } from "./secrets";

const sshPort = 22;
const connectionTimeoutMs = 30_000;
const maxAddressBytes = 4096;
const maxAddresses = 8;

export async function withAllocationSshConnection<Result>(
	ctx: ActionCtx,
	allocation: Doc<"serverAllocations">,
	run: (connection: SshConnection) => Promise<Result>,
): Promise<Result> {
	let connected = false;
	let status: AllocationPartStatus = "unknown";
	try {
		const options = await requireSshConnectionOptions(ctx, allocation);
		return await withSshConnection(options, async (connection) => {
			connected = true;
			try {
				return await run(connection);
			} finally {
				status = connection.getAccessStatus();
			}
		});
	} catch (error) {
		if (!connected) {
			status = toSshAccessStatus(error);
		}
		throw error;
	} finally {
		await recordAccess(ctx, allocation, status);
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

async function requireSshConnectionOptions(
	ctx: ActionCtx,
	allocation: Doc<"serverAllocations">,
): Promise<SshConnectionOptions> {
	if (isAllocationDeleting(allocation)) {
		throw new SshAccessError("allocation_deleting");
	}
	if (allocation.ipv4 === undefined) {
		throw new SshAccessError("allocation_unaddressed");
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
		if (allocation.status !== "running") {
			// A server that cannot answer is unknown, not refused.
			await ctx.runMutation(internal.ssh.access_state.recordAccess, {
				allocationId,
				status: "unknown",
			});
			return null;
		}
		try {
			const result = await withAllocationSshConnection(
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
		} catch {}
		return null;
	},
});
