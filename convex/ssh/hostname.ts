"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { requireSshConnection } from "./access";
import {
	runSshCommand,
	type SshConnectionOptions,
	toSshProgramCommand,
} from "./connection";
import { SshError } from "./errors";
import { hostnameScript } from "./scripts/hostname";

const maxOutputBytes = 4096;
const maxHostnameLength = 253;
const halfMinuteMs = 30_000;
const twoMinutesMs = 120_000;
const tenMinutesMs = 600_000;
// A server can be starting, rebooting, or briefly unreachable when a rename happens.
const retryDelaysMs = [halfMinuteMs, twoMinutesMs, tenMinutesMs];

/**
 * Sets the server's hostname, but only while it still matches the name Composery gave it.
 * Returns the hostname the server reports afterwards, which is what the panel shows: a
 * hostname the customer chose stays, and the panel states that it differs.
 */
export async function setSshHostname(
	connection: SshConnectionOptions,
	request: Readonly<{ expected: string | null; next: string }>,
) {
	const result = await runSshCommand(
		connection,
		toSshProgramCommand(hostnameScript),
		{ input: Buffer.from(JSON.stringify(request)), maxOutputBytes },
	);
	if (result.exitCode !== 0) {
		throw new SshError("command_unavailable");
	}
	let reported: unknown;
	try {
		reported = JSON.parse(result.stdout);
	} catch {
		throw new SshError("invalid_response");
	}
	const hostname =
		reported !== null &&
		typeof reported === "object" &&
		"hostname" in reported &&
		typeof reported.hostname === "string" &&
		reported.hostname.length <= maxHostnameLength
			? reported.hostname
			: null;
	return hostname;
}

/**
 * Runs after a rename, and after a host key is pinned. A server that is starting, rebooting or
 * briefly unreachable gets a few more attempts; after that its hostname stays as it is, and the
 * status shows a hostname that differs from the server's name.
 */
export const apply = internalAction({
	args: {
		serverId: v.id("servers"),
		expected: v.union(v.string(), v.null()),
		next: v.string(),
		attempt: v.number(),
	},
	returns: v.null(),
	handler: async (ctx, { serverId, expected, next, attempt }) => {
		const allocation: Doc<"serverAllocations"> | null = await ctx.runQuery(
			internal.allocations.operations.getForServer,
			{ serverId },
		);
		if (allocation === null || allocation.deleteRequested) {
			return null;
		}
		try {
			const connection = await requireSshConnection(ctx, allocation);
			const hostname = await setSshHostname(connection, { expected, next });
			if (hostname !== null) {
				await ctx.runMutation(internal.allocations.operations.storeHostname, {
					allocationId: allocation._id,
					hostname,
				});
			}
		} catch (error) {
			const delay = retryDelaysMs[attempt];
			if (delay === undefined) {
				throw error;
			}
			await ctx.scheduler.runAfter(delay, internal.ssh.hostname.apply, {
				serverId,
				expected,
				next,
				attempt: attempt + 1,
			});
		}
		return null;
	},
});
