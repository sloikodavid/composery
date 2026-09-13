import { DAY, HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
	slugAttempt: {
		kind: "token bucket",
		rate: 1000,
		period: HOUR,
		capacity: 200,
	},
	slugClaim: { kind: "token bucket", rate: 1000, period: DAY, capacity: 200 },
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
