import type { Infer } from "convex/values";
import type { StoredSnapshotPolicy, vSnapshotClass } from "../schema";

type SnapshotClass = Infer<typeof vSnapshotClass>;

export type SnapshotPolicy = {
	manualCap: number;
	automaticCap: number;
	manualMinIntervalMinutes: number;
	manualRetentionDays: number;
	automaticRetentionDays: number;
};

export const DEFAULT_SNAPSHOT_POLICY: SnapshotPolicy = {
	manualCap: 15,
	automaticCap: 7,
	manualMinIntervalMinutes: 5,
	manualRetentionDays: 30,
	automaticRetentionDays: 7
};

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const SNAPSHOT_MANUAL_MIN_INTERVAL_MS =
	DEFAULT_SNAPSHOT_POLICY.manualMinIntervalMinutes * MINUTE_MS;

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
		manualCap: resolvedPositiveInteger(
			stored.manual_cap,
			DEFAULT_SNAPSHOT_POLICY.manualCap
		),
		automaticCap: resolvedPositiveInteger(
			stored.automatic_cap,
			DEFAULT_SNAPSHOT_POLICY.automaticCap
		),
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
		manual_cap: policy.manualCap,
		automatic_cap: policy.automaticCap,
		manual_min_interval_minutes: policy.manualMinIntervalMinutes,
		manual_retention_days: policy.manualRetentionDays,
		automatic_retention_days: policy.automaticRetentionDays
	};
}

export function validateSnapshotPolicy(policy: SnapshotPolicy) {
	const {
		manualCap,
		automaticCap,
		manualMinIntervalMinutes,
		manualRetentionDays,
		automaticRetentionDays
	} = policy;
	const values = {
		manualCap,
		automaticCap,
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

export const SNAPSHOT_INCOMPLETE_RETENTION_MS = 24 * 60 * 60 * 1000;

export const SNAPSHOT_RETENTION_SWEEP_BATCH = 200;

export const SNAPSHOT_POLL_FAST_MS = 10 * 1000;
export const SNAPSHOT_POLL_SLOW_MS = 30 * 1000;
export const SNAPSHOT_POLL_FAST_WINDOW_MS = 60 * 1000;
export const SNAPSHOT_CAPTURE_DEADLINE_MS = 60 * 60 * 1000;

export function snapshotExpiry(
	cls: SnapshotClass,
	createdAt: number,
	policy: SnapshotPolicy = DEFAULT_SNAPSHOT_POLICY
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

export function snapshotIdempotencyBucket(
	now: number = Date.now(),
	manualMinIntervalMs: number = SNAPSHOT_MANUAL_MIN_INTERVAL_MS
) {
	return Math.floor(now / manualMinIntervalMs).toString(36);
}

export function snapshotEvictionCount(
	activeSnapshotCount: number,
	cap: number
) {
	return activeSnapshotCount >= cap ? activeSnapshotCount - cap + 1 : 0;
}
