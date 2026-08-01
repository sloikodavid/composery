import { internalMutation, type MutationCtx } from "../_generated/server";
import { readGlobalSettings } from "../settings";
import { staffConsoleUrl } from "../env";
import { raiseAlert } from "../staff/alerts";
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
	// Unreachable, and kept because the type system cannot see that: getting here
	// means `limitBlockReason` is null *and* differs from `previous`, so `previous`
	// is not null. The two returns below need that, and there is no assertion-free
	// way to tell TypeScript. No test can distinguish either branch of it.
	// Stryker disable next-line ConditionalExpression,ObjectLiteral,StringLiteral: unreachable narrowing - the first comparison above already returned for every input that could reach it with a null `previous`.
	if (!previous) return { type: "none" };
	if (usage.blockReason === "limits_not_configured") return { type: "clear" };
	return { type: "recovered", reason: previous };
}

function capacityLabel(reason: CapacityLimitBlockReason) {
	return reason === "server_limit" ? "server" : "snapshot";
}

export async function reconcileCapacityAlert(ctx: MutationCtx) {
	const stored = await ctx.db.query("settings").first();
	const settings = await readGlobalSettings(ctx);
	const usage = await readCapacityUsage(ctx, settings);
	const transition = capacityAlertTransition(
		stored?.capacity_alert_reason ?? null,
		usage
	);
	if (transition.type === "none") return transition;

	// Also unreachable, for the same shape of reason: with no settings row there
	// are no limits, so `readCapacityUsage` reports `limits_not_configured` with
	// no limit block, and `capacityAlertTransition` has already returned "none"
	// above. It stays because `stored` is what the patches below write to.
	// Stryker disable next-line ConditionalExpression: no settings row means no limits, which the "none" return above has already handled.
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
		await raiseAlert(ctx, {
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
	await raiseAlert(ctx, {
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
