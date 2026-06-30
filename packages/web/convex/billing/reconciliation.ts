import { components, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { SUBSCRIPTION_RECONCILIATION_STATUSES } from "../boxes/boxQueries";
import { startBoxOperation } from "../boxes/boxOperations";

type ReconciliationPage = {
	continueCursor: string;
	isDone: boolean;
	page: Doc<"boxes">[];
};

async function reconcileBoxSubscription(ctx: ActionCtx, box: Doc<"boxes">) {
	const subscription = await ctx.runQuery(
		components.polar.lib.getSubscription,
		{
			id: box.polar_subscription_id
		}
	);
	if (!subscription) return;

	const now = new Date().toISOString();
	const revoked =
		subscription.status === "revoked" ||
		subscription.status === "unpaid" ||
		(subscription.endedAt !== null && subscription.endedAt <= now);

	if (!revoked) return;

	try {
		await startBoxOperation(ctx, box._id, "delete", {
			idempotencyKey: `delete:${box.polar_subscription_id}`
		});
	} catch {
		// Box is busy or already tearing down; leave it for the next sweep.
	}
}

export const deleteBoxesWithoutActiveSubscriptions = internalAction({
	args: {},
	handler: async (ctx) => {
		for (const status of SUBSCRIPTION_RECONCILIATION_STATUSES) {
			let cursor: string | null = null;

			for (;;) {
				const page: ReconciliationPage = await ctx.runQuery(
					internal.boxes.boxQueries.boxesForSubscriptionReconciliationPage,
					{ cursor, status }
				);
				for (const box of page.page) {
					await reconcileBoxSubscription(ctx, box);
				}

				if (page.isDone) break;
				cursor = page.continueCursor;
			}
		}
	}
});
