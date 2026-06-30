"use node";

import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { fetchServerMetricsSample } from "./infra/hetznerVps";
import { METRICS_POLL_INTERVAL_MS, POLLED_STATUSES } from "./boxMetrics";
import { startBoxSuspension } from "./boxOperations";

const POLL_CONCURRENCY = 10;

type PollTarget = {
	boxId: Id<"boxes">;
	serverId: number;
	slug: string;
};

type PollTargetsPage = {
	continueCursor: string;
	isDone: boolean;
	page: PollTarget[];
};

async function pollTargets(ctx: ActionCtx, targets: PollTarget[]) {
	for (let index = 0; index < targets.length; index += POLL_CONCURRENCY) {
		await Promise.all(
			targets.slice(index, index + POLL_CONCURRENCY).map(async (target) => {
				// One box failing must not stop the rest of the fleet.
				try {
					const sample = await fetchServerMetricsSample(
						target.serverId,
						METRICS_POLL_INTERVAL_MS
					);
					const { suspendFlagId, suspendReason } = await ctx.runMutation(
						internal.boxes.boxMetrics.recordSample,
						{ boxId: target.boxId, ...sample }
					);

					if (suspendFlagId && suspendReason) {
						await startBoxSuspension(ctx, {
							boxId: target.boxId,
							idempotencyKeyPrefix: `flag:${suspendFlagId}`,
							reason: suspendReason,
							suspend: true
						});
					}
				} catch (error) {
					console.error(`Metrics poll failed for box ${target.slug}.`, error);
				}
			})
		);
	}
}

export const pollBoxMetrics = internalAction({
	args: {},
	handler: async (ctx) => {
		for (const status of POLLED_STATUSES) {
			let cursor: string | null = null;

			for (;;) {
				const page: PollTargetsPage = await ctx.runQuery(
					internal.boxes.boxMetrics.pollTargetsPage,
					{ cursor, status }
				);
				await pollTargets(ctx, page.page);

				if (page.isDone) break;
				cursor = page.continueCursor;
			}
		}
	}
});
