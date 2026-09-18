import { type Infer, v } from "convex/values";

/**
 * What a failure means for what to do next. The count of failures changes how visible one is, never
 * what it means: a request repeated often enough does not turn a passing condition into a permanent
 * one, and giving up on a customer's server is worse than asking again in an hour.
 */
export const failureClass = v.union(
	// The same request can work shortly: the provider was busy, or nothing answered.
	v.literal("transient"),
	// Something outside has to change first: capacity, a quota, a lock, a resource somebody moved.
	v.literal("waiting"),
	// The request cannot work until its configuration changes, so asking often is pointless.
	v.literal("invalid"),
	// The request may have taken effect. Look for what it would have made; never send it again.
	v.literal("indeterminate"),
	// Composery itself is wrong. Repeating it quickly would only make one defect louder.
	v.literal("bug"),
);

export type FailureClass = Infer<typeof failureClass>;

const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;
const shortWait = 10 * second;
const longWait = 10 * minute;

/**
 * How long to wait before the next attempt. Nothing here decides whether the request itself may be
 * sent again: a resource whose outcome nobody knows is looked for instead, which is a property of
 * that resource rather than of the failure.
 */
const schedules = {
	transient: { firstMs: shortWait, maxMs: longWait },
	waiting: { firstMs: minute, maxMs: hour },
	invalid: { firstMs: longWait, maxMs: hour },
	// Looking for what a lost request may have made is cheap, and the sooner it is found the sooner
	// the work goes on. What must not happen quickly is sending that request again, and nothing here
	// does that.
	indeterminate: { firstMs: shortWait, maxMs: longWait },
	bug: { firstMs: longWait, maxMs: hour },
} as const satisfies Record<FailureClass, { firstMs: number; maxMs: number }>;

const jitterMs = 5000;
const doublings = 8;

/** Backoff for one class, spread so that many allocations do not return at the same moment. */
export function toRetryDelayMs(kind: FailureClass, failures: number) {
	const { firstMs, maxMs } = schedules[kind];
	return (
		Math.min(maxMs, firstMs * 2 ** Math.min(failures, doublings)) +
		Math.floor(Math.random() * jitterMs)
	);
}

/**
 * How many failures of a kind pass before it is worth telling anybody. This is the only thing the
 * count decides. A provider that was busy once, or one lost answer, is ordinary and says nothing; the
 * same thing for minutes is worth showing, and a condition that needs somebody to act says so at once.
 */
const showAfter = {
	transient: 5,
	waiting: 1,
	invalid: 1,
	indeterminate: 3,
	bug: 1,
} as const satisfies Record<FailureClass, number>;

/** Whether this failure, having happened this often, is worth showing as stuck. */
export function isStuck(kind: FailureClass, failures: number) {
	return failures >= showAfter[kind];
}
