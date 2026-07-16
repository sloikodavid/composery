"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { cloudUrl } from "../env";

const HEALTH_TIMEOUT_MS = 5_000;

export const probeRuntime = internalAction({
	args: {
		boxId: v.id("boxes")
	},
	returns: v.object({
		reachable: v.boolean()
	}),
	handler: async (ctx, args): Promise<{ reachable: boolean }> => {
		const box = await ctx.runQuery(
			internal.boxes.boxQueries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		try {
			const response = await fetch(
				new URL("/_composery/healthz", cloudUrl(box.slug)),
				{
					cache: "no-store",
					redirect: "manual",
					signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
				}
			);
			return { reachable: response.ok };
		} catch {
			return { reachable: false };
		}
	}
});
