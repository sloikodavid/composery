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

// What each queue may spend of the hour Hetzner states. The rest is headroom for runs already
// under way when the budget runs low, for setting up a project, and for a person in the console.
const shares = {
	work: 0.5,
	cleanup: 0.3,
} as const satisfies Record<HetznerCloudQueue, number>;
// One burst is the same size on both queues. Taking an allocation apart costs more requests than
// putting one together, and it is what gives a customer's addresses and quota back.
const burstShare = 0.05;
// What is kept back when the budget runs low: every run that can be under way at once, each at
// the most requests one run sends.
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

/** What is left at `now`, with what Hetzner has given back since it last answered. */
function getRemaining(budget: HetznerCloudBudget, now: number) {
	if (now >= budget.resetAt || budget.remaining >= budget.limit) {
		return budget.limit;
	}
	const returned =
		((budget.limit - budget.remaining) * (now - budget.observedAt)) /
		(budget.resetAt - budget.observedAt);
	return budget.remaining + returned;
}

/**
 * When more than the reserve is left again, or `now` while it is. Hetzner gives requests back
 * gradually, so this is when enough of them are back, and not when all of them are.
 */
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

/** Keeps the newest word, because runs report back in any order. */
async function storeHetznerCloudBudget(
	ctx: MutationCtx,
	controllerId: string,
	budget: HetznerCloudBudget | undefined,
) {
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

/**
 * Null when a run on this queue may start, or when to ask again. Nothing is spent here: a run pays
 * for the requests it sent once it is over, because only then is the number known.
 */
export async function checkHetznerCloudPacing(
	ctx: MutationCtx,
	controllerId: string,
	queue: HetznerCloudQueue,
): Promise<number | null> {
	const budget = await getHetznerCloudBudget(ctx, controllerId);
	// Nothing says what a project allows before Hetzner has answered once. The first run finds
	// out, and the work pools' parallelism bounds how many start before it does.
	if (budget === null) {
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

/** Records what a run spent and what Hetzner said, and returns when the next run may start. */
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
		// Spent already, so it is recorded even past the bucket: the next run waits for it instead.
		await pacingLimiter.limit(ctx, pacingNames[queue], {
			count: usage.requests,
			reserve: true,
			config: toPacingConfig(budget.limit, queue),
		});
	}
	return getHetznerCloudResumeAt(budget, now);
}
