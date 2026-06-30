---
title: Maintenance
description: Hardcoded scheduling constants and the cron schedule that drives periodic work.
---

A reference for what's hardcoded and why, and the cron schedule that drives the
periodic work.

Runtime-tunable settings - abuse thresholds, the auto-suspend toggle,
snapshot policy, and the checkout toggle - live in the `settings` table and
are edited directly on the staff console at `/console`. This doc covers only
what you can't change without a redeploy.

Grounded in the code at the time of writing. When a value moves between
hardcoded and console-configurable, update this file in the same change.

## Hardcoded in code

These are internal scheduling, cleanup, and infrastructure concerns. They
don't change at runtime without a redeploy, and exposing them to operators
would invite misconfiguration without adding value.

### Metrics polling (`convex/boxes/boxMetrics.ts`)

| Constant                        | Value     | Why it's hardcoded                                                                              |
| ------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `METRICS_POLL_INTERVAL_MINUTES` | `10`      | Drives the cron schedule in `convex/crons.ts`. Convex crons are fixed at deploy time.           |
| `RAW_RETENTION_MS`              | `2` days  | How long raw per-poll samples live before the daily sweep.                                      |
| `ROLLUP_RETENTION_MS`           | `30` days | How long hourly rollups live.                                                                   |
| `FLAG_COOLOFF_MS`               | `6` hours | Per-signal-per-box cooloff to prevent flag spam.                                                |
| `POLL_TARGET_PAGE_SIZE`         | `200`     | Pagination batch for the fleet poll.                                                            |
| `POLL_CONCURRENCY`              | `10`      | Hetzner metrics calls fired in parallel per batch (`boxMetricsPoll.ts`). Lower if rate-limited. |
| `RETENTION_DELETE_BATCH`        | `1000`    | Delete batch for the retention sweep.                                                           |
| `ROLLUP_BOX_BATCH`              | `200`     | Pagination batch for the hourly rollup.                                                         |
| `STAFF_ALERT_RECIPIENT_LIMIT`   | `50`      | Max admin users to email per alert.                                                             |

### Snapshot internals (`convex/boxes/snapshotPolicy.ts`)

| Constant                           | Value        | Why it's hardcoded                                             |
| ---------------------------------- | ------------ | -------------------------------------------------------------- |
| `SNAPSHOT_SCHEDULE_STAGGER_MS`     | `20` seconds | Stagger between automatic snapshots across the fleet.          |
| `SNAPSHOT_INCOMPLETE_RETENTION_MS` | `24` hours   | How long a failed/in-flight snapshot row lives before cleanup. |
| `SNAPSHOT_RETENTION_SWEEP_BATCH`   | `200`        | Delete batch for the expired-snapshot sweep.                   |
| `SNAPSHOT_POLL_FAST_MS`            | `10` seconds | Fast poll interval for snapshot action status.                 |
| `SNAPSHOT_POLL_SLOW_MS`            | `30` seconds | Slow poll interval after the opening window.                   |
| `SNAPSHOT_POLL_FAST_WINDOW_MS`     | `60` seconds | Window before backing off to slow poll.                        |
| `SNAPSHOT_CAPTURE_DEADLINE_MS`     | `1` hour     | Max time to wait for a Hetzner `create_image` to finish.       |

Snapshots themselves are covered in [Hetzner](./hetzner.md#box-snapshots).

### Checkout reservation (`convex/checkout/checkoutIntents.ts`)

| Constant                      | Value    | Why it's hardcoded                           |
| ----------------------------- | -------- | -------------------------------------------- |
| `CHECKOUT_RESERVATION_TTL_MS` | `1` hour | How long a slug is reserved during checkout. |

## Cron schedule

Defined in `convex/crons.ts`. All times are UTC.

| Schedule                    | When             | Function                                                       |
| --------------------------- | ---------------- | -------------------------------------------------------------- |
| Release expired intents     | Every 15 minutes | `checkout.checkoutIntents.releaseExpiredCheckoutIntents`       |
| Subscription reconciliation | Hourly at :11    | `billing.reconciliation.deleteBoxesWithoutActiveSubscriptions` |
| Poll box metrics            | Every 10 minutes | `boxes.boxMetricsPoll.pollBoxMetrics`                          |
| Roll up hourly metrics      | Hourly at :04    | `boxes.boxMetrics.rollupHourlyMetrics`                         |
| Delete old metrics          | Daily at 04:23   | `boxes.boxMetrics.deleteOldSamples`                            |
| Snapshot running boxes      | Daily at 03:07   | `boxes.boxSnapshots.scheduleAutomaticSnapshots`                |
| Delete expired snapshots    | Daily at 04:41   | `boxes.boxSnapshots.deleteExpiredSnapshots`                    |
| Reconcile Hetzner resources | Daily at 05:17   | `boxes.reconcile.reconcileHetznerResources`                    |

`reconcileHetznerResources` is the backstop for leaked cloud resources: it
deletes snapshot images that no longer have a `box_snapshots` row (pure cost,
invisible in the UI) and logs [Hetzner](./hetzner.md) servers with no live box
for staff review. A 2-hour grace window keeps it off anything still being
created.

## Stats overview (`convex/staff/stats.ts`)

The console home tiles ("Active boxes", "Needs attention", etc.) count boxes
by status via indexed queries, capped at 1,000 per status. At the current
scale this is fine; if a single status ever exceeds 1,000, the count shows a
`+` suffix. A denormalized counter table would be the fix at scale.

| Tile             | What it counts                                                                         |
| ---------------- | -------------------------------------------------------------------------------------- |
| Active boxes     | Every box not `deleted` (15 statuses summed)                                           |
| Suspended        | Boxes with status `suspended`                                                          |
| Needs attention  | Boxes with `provisioning_failed`, `reset_failed`, `restore_failed`, or `delete_failed` |
| Signups / 7d     | Users created in the last 7 days                                                       |
| New boxes / 7d   | Boxes created in the last 7 days                                                       |
| Conversion / 30d | Converted checkout intents / total intents over 30 days                                |
