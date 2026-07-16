"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
	vRecoveryStatus,
	vRecoveryType,
	type RecoveryStatus
} from "./boxRecoveryTypes";

export const status = internalAction({
	args: { boxId: v.id("boxes") },
	returns: vRecoveryStatus,
	handler: async (ctx, args): Promise<RecoveryStatus> => {
		const [http, host] = await Promise.all([
			ctx.runAction(internal.boxes.boxHealth.probeRuntime, args),
			ctx.runAction(internal.boxes.infra.ssh.inspectRuntime, args)
		]);
		return { ...host, httpReachable: http.reachable };
	}
});

export const run = internalAction({
	args: {
		boxId: v.id("boxes"),
		type: vRecoveryType
	},
	handler: async (ctx, args): Promise<void> => {
		const box = await ctx.runQuery(
			internal.boxes.boxQueries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		if (!box.hetzner_server_id) throw new Error("Box has no Hetzner server.");

		if (args.type === "reboot_server") {
			await ctx.runAction(internal.boxes.infra.hetznerVps.rebootServer, {
				serverId: box.hetzner_server_id
			});
		} else if (args.type === "restore_runtime") {
			await ctx.runAction(internal.boxes.infra.ssh.bootstrapRuntime, {
				boxId: args.boxId
			});
		} else {
			await ctx.runAction(internal.boxes.infra.ssh.recoverRuntime, {
				boxId: args.boxId,
				type: args.type
			});
		}
	}
});
