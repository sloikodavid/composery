import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { vRecoveryStatus, type RecoveryStatus } from "./boxRecoveryTypes";

// Probes the public URL and inspects the host over SSH in parallel, so the
// Repair dialog can show one honest picture of every layer. Read-only: the
// single Repair action is the only thing that changes the box.
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
