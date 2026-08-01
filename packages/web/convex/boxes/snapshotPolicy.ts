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

export type SnapshotPollOutcome =
	| { type: "complete" }
	| { type: "failed"; error: string }
	| { type: "wait"; delayMs: number };

// What the capture loop does about one Hetzner action status, decided in one
// place instead of as four branches inside a workflow body nothing can reach.
//
// The deadline is checked *after* the terminal statuses, and that order is the
// point: an action that has already succeeded is a success even if the loop took
// longer than the deadline to notice, and failing it there would delete a
// snapshot image that exists and bill for it until reconciliation finds it.
export function snapshotPollOutcome(input: {
	error?: string | null;
	status: string;
	waitedMs: number;
}): SnapshotPollOutcome {
	if (input.status === "success") return { type: "complete" };
	if (input.status === "error") {
		return {
			type: "failed",
			error: input.error ?? "Hetzner snapshot creation failed."
		};
	}
	if (input.waitedMs >= SNAPSHOT_CAPTURE_DEADLINE_MS) {
		return {
			type: "failed",
			error: "Snapshot creation did not finish before the deadline."
		};
	}
	return { type: "wait", delayMs: snapshotPollDelayMs(input.waitedMs) };
}

// Hetzner reports an image's size in gigabytes; the row stores bytes, so the
// chart and the console are not each doing this multiplication. An image with no
// size yet is stored as no size rather than as zero, which would read as a
// snapshot that captured nothing.
export function snapshotSizeBytes(imageSizeGb: number | undefined) {
	return imageSizeGb ? Math.round(imageSizeGb * 1e9) : undefined;
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

// The window one automatic snapshot's idempotency key covers, and therefore the
// cadence of the "snapshot running boxes" cron: a re-run of tonight's sweep
// deduplicates against tonight's key, and tomorrow's does not.
//
// Its own constant because it used to borrow `manualMinIntervalMinutes` - an
// operator setting about a different thing entirely. Set that above a day and
// consecutive nights fall into one bucket, so `startBoxOperation` returns null
// and the box simply does not get its daily snapshot. Nothing fails, nothing is
// recorded, and the first symptom is a restore that has nothing recent to
// restore from. `tests/behavior/convex/crons.test.ts` pins the cron to it.
export const AUTOMATIC_SNAPSHOT_INTERVAL_MS = DAY_MS;

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
