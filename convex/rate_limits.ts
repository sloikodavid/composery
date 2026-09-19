import {
	DAY,
	HOUR,
	type RateLimitConfig,
	RateLimiter,
	type RunMutationCtx,
} from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";
import { type Failure, fail, toConvexError } from "./errors";

const rateLimits = {
	serverNameAttempt: {
		kind: "token bucket",
		rate: 1000,
		period: HOUR,
		capacity: 200,
	},
	serverNameClaim: {
		kind: "token bucket",
		rate: 100,
		period: DAY,
		capacity: 100,
	},
	serverMemberLookup: {
		kind: "token bucket",
		rate: 200,
		period: HOUR,
		capacity: 50,
	},
	serverChange: {
		kind: "token bucket",
		rate: 1000,
		period: HOUR,
		capacity: 200,
	},
	userSync: { kind: "token bucket", rate: 10, period: HOUR, capacity: 3 },
} as const satisfies Record<string, RateLimitConfig>;

export const rateLimiter = new RateLimiter(components.rateLimiter, rateLimits);

type RateLimitName = keyof typeof rateLimits;

/** Return a failure so the counted attempt remains counted. */
export async function checkRateLimit(
	ctx: RunMutationCtx,
	name: RateLimitName,
	key: string,
): Promise<Failure | null> {
	const rateLimit = await rateLimiter.limit(ctx, name, { key });
	return rateLimit.ok ? null : fail("rate_limited");
}

export async function requireRateLimit(
	ctx: RunMutationCtx,
	name: RateLimitName,
	key: string,
) {
	if ((await checkRateLimit(ctx, name, key)) !== null) {
		throw toConvexError("rate_limited");
	}
}
