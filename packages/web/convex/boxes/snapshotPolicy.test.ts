import { describe, expect, it } from "vitest";
import {
	DEFAULT_SNAPSHOT_POLICY,
	SNAPSHOT_CAPTURE_DEADLINE_MS,
	SNAPSHOT_POLL_FAST_MS,
	SNAPSHOT_POLL_FAST_WINDOW_MS,
	SNAPSHOT_POLL_SLOW_MS,
	SNAPSHOT_MANUAL_MIN_INTERVAL_MS,
	SNAPSHOT_SCHEDULE_STAGGER_MS,
	resolveSnapshotPolicy,
	snapshotEvictionCount,
	snapshotExpiry,
	snapshotIdempotencyBucket,
	snapshotPolicyToStored,
	snapshotPollDelayMs,
	snapshotScheduleDelayMs
} from "./snapshotPolicy";

const DAY = 24 * 60 * 60 * 1000;

describe("snapshot retention", () => {
	it("keeps manual snapshots far longer than automatic ones", () => {
		const created = 1_000_000;
		expect(snapshotExpiry("manual", created)).toBe(created + 30 * DAY);
		expect(snapshotExpiry("scheduled", created)).toBe(created + 7 * DAY);
	});

	it("uses a resolved retention policy when provided", () => {
		const created = 1_000_000;
		expect(
			snapshotExpiry("manual", created, {
				...DEFAULT_SNAPSHOT_POLICY,
				manualRetentionDays: 2,
				automaticRetentionDays: 1
			})
		).toBe(created + 2 * DAY);
		expect(
			snapshotExpiry("scheduled", created, {
				...DEFAULT_SNAPSHOT_POLICY,
				manualRetentionDays: 2,
				automaticRetentionDays: 1
			})
		).toBe(created + DAY);
	});
});

describe("resolveSnapshotPolicy", () => {
	it("returns defaults without a stored policy", () => {
		expect(resolveSnapshotPolicy(undefined)).toEqual(DEFAULT_SNAPSHOT_POLICY);
	});

	it("keeps safe stored values and falls back unsafe fields independently", () => {
		expect(
			resolveSnapshotPolicy({
				manual_cap: 3,
				automatic_cap: 0,
				manual_min_interval_minutes: 0,
				manual_retention_days: 14,
				automatic_retention_days: Number.POSITIVE_INFINITY
			})
		).toEqual({
			manualCap: 3,
			automaticCap: DEFAULT_SNAPSHOT_POLICY.automaticCap,
			manualMinIntervalMinutes:
				DEFAULT_SNAPSHOT_POLICY.manualMinIntervalMinutes,
			manualRetentionDays: 14,
			automaticRetentionDays: DEFAULT_SNAPSHOT_POLICY.automaticRetentionDays
		});
	});

	it("rejects unsafe policy values before storage conversion", () => {
		expect(() =>
			snapshotPolicyToStored({
				...DEFAULT_SNAPSHOT_POLICY,
				manualCap: 0
			})
		).toThrow("manualCap must be a positive integer.");
	});
});

describe("snapshot poll backoff", () => {
	it("polls fast inside the opening window, then backs off", () => {
		expect(snapshotPollDelayMs(0)).toBe(SNAPSHOT_POLL_FAST_MS);
		expect(snapshotPollDelayMs(SNAPSHOT_POLL_FAST_WINDOW_MS - 1)).toBe(
			SNAPSHOT_POLL_FAST_MS
		);
		expect(snapshotPollDelayMs(SNAPSHOT_POLL_FAST_WINDOW_MS)).toBe(
			SNAPSHOT_POLL_SLOW_MS
		);
		expect(snapshotPollDelayMs(SNAPSHOT_CAPTURE_DEADLINE_MS)).toBe(
			SNAPSHOT_POLL_SLOW_MS
		);
	});

	it("walks the whole deadline in a finite number of polls", () => {
		// The capture loop adds snapshotPollDelayMs each iteration until the
		// deadline; a regression that returned 0 here would spin forever.
		let waited = 0;
		let polls = 0;
		while (waited < SNAPSHOT_CAPTURE_DEADLINE_MS) {
			waited += snapshotPollDelayMs(waited);
			polls += 1;
			expect(polls).toBeLessThan(10_000);
		}
		expect(polls).toBeGreaterThan(0);
	});
});

describe("snapshotScheduleDelayMs", () => {
	it("staggers scheduled snapshots by their fleet index", () => {
		expect(snapshotScheduleDelayMs(0)).toBe(0);
		expect(snapshotScheduleDelayMs(1)).toBe(SNAPSHOT_SCHEDULE_STAGGER_MS);
		expect(snapshotScheduleDelayMs(5)).toBe(5 * SNAPSHOT_SCHEDULE_STAGGER_MS);
	});
});

describe("snapshotIdempotencyBucket", () => {
	it("collapses requests inside one min-interval window, separates later ones", () => {
		const now = 1_000_000_000;
		const bucket = snapshotIdempotencyBucket(now);
		expect(snapshotIdempotencyBucket(now + 1000)).toBe(bucket);
		expect(
			snapshotIdempotencyBucket(now + SNAPSHOT_MANUAL_MIN_INTERVAL_MS)
		).not.toBe(bucket);
	});
});

describe("snapshotEvictionCount", () => {
	it("requires no eviction below the cap", () => {
		expect(snapshotEvictionCount(6, 7)).toBe(0);
	});

	it("evicts one snapshot at the cap to leave room for the new row", () => {
		expect(snapshotEvictionCount(7, 7)).toBe(1);
	});

	it("evicts enough snapshots to land at the cap after inserting", () => {
		expect(snapshotEvictionCount(9, 7)).toBe(3);
	});
});
