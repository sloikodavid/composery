import { internalMutation, type MutationCtx } from "../_generated/server";
import { readGlobalSettings } from "../settings";
import { sendStaffAlert, staffConsoleUrl } from "../staffAlerts";
import {
	readCapacityUsage,
	type CapacityLimitBlockReason,
	type CapacityUsage
} from "./capacity";

type CapacityAlertTransition =
	| { type: "none" }
	| { type: "clear" }
	| { type: "blocked"; reason: CapacityLimitBlockReason }
	| { type: "recovered"; reason: CapacityLimitBlockReason };

export function capacityAlertTransition(
	previous: CapacityLimitBlockReason | null,
	usage: Pick<CapacityUsage, "blockReason" | "limitBlockReason">
): CapacityAlertTransition {
	if (usage.limitBlockReason === previous) return { type: "none" };
	if (usage.limitBlockReason) {
		return { type: "blocked", reason: usage.limitBlockReason };
	}
	if (!previous) return { type: "none" };
	if (usage.blockReason === "limits_not_configured") return { type: "clear" };
	return { type: "recovered", reason: previous };
}

function capacityLabel(reason: CapacityLimitBlockReason) {
	return reason === "server_limit" ? "server" : "snapshot";
}

export async function reconcileCapacityAlert(ctx: MutationCtx) {
	const stored = await ctx.db
		.query("settings")
		.withIndex("key", (query) => query.eq("key", "global"))
		.first();
	const settings = await readGlobalSettings(ctx);
	const usage = await readCapacityUsage(ctx, settings);
	const transition = capacityAlertTransition(
		stored?.capacity_alert_reason ?? null,
		usage
	);
	if (transition.type === "none") return transition;

	if (!stored) return transition;
	if (transition.type === "clear") {
		await ctx.db.patch(stored._id, {
			capacity_alert_reason: undefined,
			capacity_alert_started_at: undefined
		});
		return transition;
	}

	if (transition.type === "blocked") {
		const startedAt = Date.now();
		await ctx.db.patch(stored._id, {
			capacity_alert_reason: transition.reason,
			capacity_alert_started_at: startedAt
		});
		const label = capacityLabel(transition.reason);
		await sendStaffAlert(ctx, {
			key: `capacity-exhausted:${transition.reason}:${startedAt}`,
			severity: "critical",
			subject: `New box ${label} capacity is exhausted`,
			text: `The configured Hetzner ${label} allocation can no longer fit another complete box package. New checkout is blocked by capacity admission; existing boxes are unaffected.\n\nReview commitments and the provider allocation: ${staffConsoleUrl()}`
		});
		return transition;
	}

	const startedAt = stored.capacity_alert_started_at ?? Date.now();
	await ctx.db.patch(stored._id, {
		capacity_alert_reason: undefined,
		capacity_alert_started_at: undefined
	});
	await sendStaffAlert(ctx, {
		key: `capacity-recovered:${transition.reason}:${startedAt}`,
		severity: "resolved",
		subject: `New box ${capacityLabel(transition.reason)} capacity recovered`,
		text: `The previous ${capacityLabel(transition.reason)} capacity block has cleared. Checkout is ${usage.checkoutAvailable ? "available" : "still unavailable for another reason"}.\n\nReview the current state: ${staffConsoleUrl()}`
	});
	return transition;
}

export const reconcile = internalMutation({
	args: {},
	handler: async (ctx) => await reconcileCapacityAlert(ctx)
});
