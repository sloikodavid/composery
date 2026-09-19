import { type Infer, v } from "convex/values";

/** Controls retry behavior; it does not make an operation terminal. */
export const failureClass = v.union(
	v.literal("transient"),
	v.literal("waiting"),
	v.literal("invalid"),
	v.literal("indeterminate"), // The request may have taken effect; look it up first.
	v.literal("bug"),
);

export type FailureClass = Infer<typeof failureClass>;

const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;
const shortWait = 10 * second;
const longWait = 10 * minute;

const schedules = {
	transient: { firstMs: shortWait, maxMs: longWait },
	waiting: { firstMs: minute, maxMs: hour },
	invalid: { firstMs: longWait, maxMs: hour },
	// Indeterminate outcomes are looked up, not sent again.
	indeterminate: { firstMs: shortWait, maxMs: longWait },
	bug: { firstMs: longWait, maxMs: hour },
} as const satisfies Record<FailureClass, { firstMs: number; maxMs: number }>;

const jitterMs = 5000;
const doublings = 8;

export function toRetryDelayMs(kind: FailureClass, failures: number) {
	const { firstMs, maxMs } = schedules[kind];
	return (
		Math.min(maxMs, firstMs * 2 ** Math.min(failures, doublings)) +
		Math.floor(Math.random() * jitterMs)
	);
}

const showAfter = {
	transient: 5,
	waiting: 1,
	invalid: 1,
	indeterminate: 3,
	bug: 1,
} as const satisfies Record<FailureClass, number>;

export function isStuck(kind: FailureClass, failures: number) {
	return failures >= showAfter[kind];
}
