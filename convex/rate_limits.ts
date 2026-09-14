import {
	DAY,
	HOUR,
	MINUTE,
	type RateLimitConfig,
	RateLimiter,
	type RunMutationCtx,
} from "@convex-dev/rate-limiter";
import { ConvexError } from "convex/values";
import { components } from "./_generated/api";
import { type Failure, fail } from "./failures";

// Limits protect the system, not the pace of one person: an account can own hundreds of servers.
const rateLimits = {
	serverNameAttempt: {
		kind: "token bucket",
		rate: 1000,
		period: HOUR,
		capacity: 200,
	},
	serverNameClaim: {
		kind: "token bucket",
		rate: 1000,
		period: DAY,
		capacity: 200,
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

function toTooManyAttemptsMessage(retryAfterMs: number) {
	const minutes = Math.max(1, Math.ceil(retryAfterMs / MINUTE));
	return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

/** Counts one attempt. Return the failure, so that the counted attempt stays counted. */
export async function checkRateLimit(
	ctx: RunMutationCtx,
	name: RateLimitName,
	key: string,
): Promise<Failure | null> {
	const rateLimit = await rateLimiter.limit(ctx, name, { key });
	return rateLimit.ok
		? null
		: fail(null, toTooManyAttemptsMessage(rateLimit.retryAfter));
}

/** Counts one attempt and throws when the limit is reached. A refused attempt is not counted. */
export async function requireRateLimit(
	ctx: RunMutationCtx,
	name: RateLimitName,
	key: string,
) {
	const rateLimitFailure = await checkRateLimit(ctx, name, key);
	if (rateLimitFailure !== null) {
		throw new ConvexError({ message: rateLimitFailure.message });
	}
}
