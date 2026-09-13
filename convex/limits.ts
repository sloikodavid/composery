import { DAY, HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
	providerRequest: {
		kind: "token bucket",
		rate: 2000,
		period: HOUR,
		capacity: 30,
	},
	providerCleanup: {
		kind: "token bucket",
		rate: 500,
		period: HOUR,
		capacity: 16,
	},
	nameAttempt: {
		kind: "token bucket",
		rate: 1000,
		period: HOUR,
		capacity: 200,
	},
	nameClaim: { kind: "token bucket", rate: 1000, period: DAY, capacity: 200 },
	memberLookup: {
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
});

export function tooManyAttemptsMessage(retryAfter: number) {
	const minutes = Math.max(1, Math.ceil(retryAfter / MINUTE));
	return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}
