import type { Infer } from "convex/values";
import type { StoredSnapshotPolicy, vSnapshotClass } from "../schema";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "../time";

type SnapshotClass = Infer<typeof vSnapshotClass>;

export type SnapshotPolicy = {
	manualMinIntervalMinutes: number;
	manualRetentionDays: number;
	automaticRetentionDays: number;
};

// Timing only. How many snapshots a box may hold is its plan's business and how
// they are split is its owner's; this is how long they last and how often a
// manual one may be taken. Automatic snapshots are rolling disaster recovery and
// are kept briefly; manual ones are the owner's own checkpoints and are kept far
// longer.
export const DEFAULT_SNAPSHOT_POLICY: SnapshotPolicy = {
	manualMinIntervalMinutes: 5,
	manualRetentionDays: 30,
	automaticRetentionDays: 5
};

// The one conversion of the stored minutes into the milliseconds every caller
// actually compares against. It was written out at each call site, which is how
// the two that matter came to sit beside a module constant derived from the
// *default* policy - a value that looked like the interval and ignored the
// setting.
export function manualSnapshotIntervalMs(policy: SnapshotPolicy) {
	return policy.manualMinIntervalMinutes * MINUTE_MS;
}

function positiveInteger(value: number) {
	return Number.isFinite(value) && value > 0 && Number.isInteger(value);
}

function resolvedPositiveInteger(value: number, fallback: number) {
	return positiveInteger(value) ? value : fallback;
}

export function resolveSnapshotPolicy(
	stored: StoredSnapshotPolicy | undefined
): SnapshotPolicy {
	if (!stored) return DEFAULT_SNAPSHOT_POLICY;
	return {
		manualMinIntervalMinutes: resolvedPositiveInteger(
			stored.manual_min_interval_minutes,
			DEFAULT_SNAPSHOT_POLICY.manualMinIntervalMinutes
		),
		manualRetentionDays: resolvedPositiveInteger(
			stored.manual_retention_days,
			DEFAULT_SNAPSHOT_POLICY.manualRetentionDays
		),
		automaticRetentionDays: resolvedPositiveInteger(
			stored.automatic_retention_days,
			DEFAULT_SNAPSHOT_POLICY.automaticRetentionDays
		)
	};
}

export function snapshotPolicyToStored(
	policy: SnapshotPolicy
): StoredSnapshotPolicy {
	validateSnapshotPolicy(policy);
	return {
		manual_min_interval_minutes: policy.manualMinIntervalMinutes,
		manual_retention_days: policy.manualRetentionDays,
		automatic_retention_days: policy.automaticRetentionDays
	};
}

export function validateSnapshotPolicy(policy: SnapshotPolicy) {
	const {
		manualMinIntervalMinutes,
		manualRetentionDays,
		automaticRetentionDays
	} = policy;
	const values = {
		manualMinIntervalMinutes,
		manualRetentionDays,
		automaticRetentionDays
	};
	for (const [key, value] of Object.entries(values)) {
		if (!positiveInteger(value)) {
			throw new Error(`${key} must be a positive integer.`);
		}
	}
}

// Derived constants kept in code: stagger, incomplete retention, sweep batch,
// poll cadence, and capture deadline are internal scheduling/cleanup concerns,
// not operator policy.
export const SNAPSHOT_SCHEDULE_STAGGER_MS = 20 * 1000;

// runbook: Incomplete snapshot-row retention
export const SNAPSHOT_INCOMPLETE_RETENTION_MS = DAY_MS;

export const SNAPSHOT_RETENTION_SWEEP_BATCH = 200;

export const SNAPSHOT_POLL_FAST_MS = 10 * 1000;
export const SNAPSHOT_POLL_SLOW_MS = 30 * 1000;
export const SNAPSHOT_POLL_FAST_WINDOW_MS = MINUTE_MS;
// runbook: Snapshot capture deadline
export const SNAPSHOT_CAPTURE_DEADLINE_MS = HOUR_MS;

export function snapshotExpiry(
	cls: SnapshotClass,
	createdAt: number,
	policy: SnapshotPolicy
) {
	const retentionDays =
		cls === "manual"
			? policy.manualRetentionDays
			: policy.automaticRetentionDays;
	return createdAt + retentionDays * DAY_MS;
}

// Pure (no clock read) so it stays safe to call inside a workflow handler.
export function snapshotPollDelayMs(waitedMs: number) {
	return waitedMs < SNAPSHOT_POLL_FAST_WINDOW_MS
		? SNAPSHOT_POLL_FAST_MS
		: SNAPSHOT_POLL_SLOW_MS;
}

export function snapshotScheduleDelayMs(scheduledIndex: number) {
	return scheduledIndex * SNAPSHOT_SCHEDULE_STAGGER_MS;
}

// No defaults: every caller holds the resolved policy already, and a default
// here would silently answer with the shipped one when a deployment had
// configured something else.
export function snapshotIdempotencyBucket(
	now: number,
	manualMinIntervalMs: number
) {
	return Math.floor(now / manualMinIntervalMs).toString(36);
}

export function snapshotEvictionCount(
	activeSnapshotCount: number,
	cap: number
) {
	return activeSnapshotCount >= cap ? activeSnapshotCount - cap + 1 : 0;
}
