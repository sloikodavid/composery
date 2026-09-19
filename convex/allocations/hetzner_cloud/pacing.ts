import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import type { Infer } from "convex/values";
import { components } from "../../_generated/api";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type {
	hetznerCloudBudget,
	hetznerCloudQueue,
	hetznerCloudUsage,
} from "./schema";

type HetznerCloudQueue = Infer<typeof hetznerCloudQueue>;
export type HetznerCloudBudget = Infer<typeof hetznerCloudBudget>;

export type HetznerCloudUsage = Infer<typeof hetznerCloudUsage>;

const shares = {
	work: 0.5,
	cleanup: 0.3,
} as const satisfies Record<HetznerCloudQueue, number>;
// Cleanup gets a larger burst because it releases provider resources and quota.
const burstShare = 0.05;
// Keep headroom for work already in flight.
const budgetReserve = 20;

const pacingLimiter = new RateLimiter(components.rateLimiter);

const pacingNames = {
	work: "hetznerCloudWork",
	cleanup: "hetznerCloudCleanup",
} as const satisfies Record<HetznerCloudQueue, string>;

function toPacingConfig(limit: number, queue: HetznerCloudQueue) {
	return {
		kind: "token bucket" as const,
		rate: Math.max(1, Math.floor(limit * shares[queue])),
		period: HOUR,
		capacity: Math.max(1, Math.floor(limit * burstShare)),
	};
}

function getReserve(budget: HetznerCloudBudget) {
	return Math.min(budgetReserve, Math.floor(budget.limit / 10));
}

function getRemaining(budget: HetznerCloudBudget, now: number) {
	if (now >= budget.resetAt || budget.remaining >= budget.limit) {
		return budget.limit;
	}
	const returned =
		((budget.limit - budget.remaining) * (now - budget.observedAt)) /
		(budget.resetAt - budget.observedAt);
	return budget.remaining + returned;
}

/** Returns when enough of the provider's budget has returned. */
export function getHetznerCloudResumeAt(
	budget: HetznerCloudBudget,
	now: number,
) {
	const reserve = getReserve(budget);
	if (getRemaining(budget, now) > reserve) {
		return now;
	}
	const needed = reserve + 1 - budget.remaining;
	const span = budget.resetAt - budget.observedAt;
	return Math.min(
		budget.resetAt,
		budget.observedAt +
			Math.ceil((needed * span) / (budget.limit - budget.remaining)),
	);
}

async function getHetznerCloudBudget(ctx: QueryCtx, controllerId: string) {
	return await ctx.db
		.query("hetznerCloudBudgets")
		.withIndex("by_controller_id", (q) => q.eq("controllerId", controllerId))
		.unique();
}

async function storeHetznerCloudBudget(
	ctx: MutationCtx,
	controllerId: string,
	budget: HetznerCloudBudget | undefined,
) {
	// Reports can arrive out of order; keep the newest observation.
	if (budget === undefined) {
		return;
	}
	const existing = await getHetznerCloudBudget(ctx, controllerId);
	if (existing === null) {
		await ctx.db.insert("hetznerCloudBudgets", { controllerId, ...budget });
	} else if (existing.observedAt < budget.observedAt) {
		await ctx.db.patch("hetznerCloudBudgets", existing._id, budget);
	}
}

export async function checkHetznerCloudPacing(
	ctx: MutationCtx,
	controllerId: string,
	queue: HetznerCloudQueue,
): Promise<number | null> {
	const budget = await getHetznerCloudBudget(ctx, controllerId);
	if (budget === null) {
		// The first request discovers the provider's limit.
		return null;
	}
	const now = Date.now();
	const resumeAt = getHetznerCloudResumeAt(budget, now);
	if (resumeAt > now) {
		return resumeAt;
	}
	const pace = await pacingLimiter.check(ctx, pacingNames[queue], {
		config: toPacingConfig(budget.limit, queue),
	});
	return pace.ok ? null : now + (pace.retryAfter ?? 0);
}

export async function chargeHetznerCloudPacing(
	ctx: MutationCtx,
	controllerId: string,
	queue: HetznerCloudQueue,
	usage: HetznerCloudUsage,
) {
	await storeHetznerCloudBudget(ctx, controllerId, usage.budget);
	const budget = await getHetznerCloudBudget(ctx, controllerId);
	const now = Date.now();
	if (budget === null) {
		return now;
	}
	if (usage.requests > 0) {
		// Record usage even when it exceeds the current budget.
		await pacingLimiter.limit(ctx, pacingNames[queue], {
			count: usage.requests,
			reserve: true,
			config: toPacingConfig(budget.limit, queue),
		});
	}
	return getHetznerCloudResumeAt(budget, now);
}
