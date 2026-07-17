---
title: Maintenance
description: Runtime settings, fixed retention windows, and scheduled backend work.
---

This page contains operational timing and retention behavior that matters when
running the hosted product. Implementation batch sizes and internal helper
constants are deliberately omitted; the code is the source of truth for those
and duplicating them here adds maintenance without helping an operator.

## Runtime settings

The staff console at **/console** owns the values that should change without a
deployment:

- checkout enabled/disabled;
- the Hetzner server and snapshot allocations assigned to this deployment;
- per-user concurrent unpaid checkout reservations;
- snapshot caps, minimum interval, and retention;
- abuse/resource thresholds; and
- automatic suspension enabled/disabled.

Checkout fails closed until both Hetzner allocations are configured. Read
[Operations](./operations.md) before changing allocations or destructive
behavior.

## Fixed windows

These values intentionally require a code change and deployment because they
define evidence retention, retry cadence, or background workload:

| Behavior                           | Window                              |
| ---------------------------------- | ----------------------------------- |
| Unpaid checkout reservation        | 1 hour                              |
| Metrics polling                    | 10 minutes                          |
| Raw metrics retention              | 2 days                              |
| Hourly metrics retention           | 30 days                             |
| Repeat flag cooloff per box/signal | 6 hours                             |
| Staff-alert retry                  | 15 minutes                          |
| Staff-alert record retention       | 180 days                            |
| Stuck account-deletion alert       | After 24 hours                      |
| Incomplete snapshot-row retention  | 24 hours                            |
| Snapshot capture deadline          | 1 hour                              |
| Deleted box/support evidence       | 180 days                            |
| Unpaid checkout record             | 30 days                             |
| Paid billing record                | 6 calendar years after the box ends |

Paid initial-fulfillment failure, provider cleanup, capacity admission, and
refund behavior are specified once in [Operations](./operations.md),
[Polar](./services/polar.md), and [Hetzner](./services/hetzner.md).

## Scheduled work

Convex owns every periodic backend job; no separate worker service is required.
All fixed times are UTC.

| Job                                       | Schedule         |
| ----------------------------------------- | ---------------- |
| Release expired checkout intents          | Every 15 minutes |
| Delete expired box authorization          | Every 15 minutes |
| Reconcile calculated capacity-alert state | Every 15 minutes |
| Retry unsent staff alerts                 | Every 15 minutes |
| Poll box metrics                          | Every 10 minutes |
| Reconcile Polar subscriptions             | Hourly at :11    |
| Continue pending account deletion         | Hourly at :19    |
| Roll up hourly metrics                    | Hourly at :04    |
| Snapshot running boxes                    | Daily at 03:07   |
| Delete old metrics                        | Daily at 04:23   |
| Normalize deleted boxes                   | Daily at 04:29   |
| Purge deleted boxes                       | Daily at 04:31   |
| Purge checkout records                    | Daily at 04:37   |
| Purge deleted accounts                    | Daily at 04:39   |
| Delete expired snapshots                  | Daily at 04:41   |
| Purge staff-alert records                 | Daily at 04:43   |
| Reconcile Hetzner resources               | Daily at 05:17   |

The schedule is defined in **packages/web/convex/crons.ts**. A schedule change
must update this table in the same commit because the table is the operator's
UTC runbook, not an implementation inventory.

Hetzner reconciliation deletes untracked product snapshot images only after a
two-hour grace period. It never deletes an untracked server automatically; it
records and alerts on the server for manual review. Polar and Hetzner
reconciliation failures also create rate-limited staff alerts.

## Retained deleted data

Deletion removes secrets, live infrastructure references, snapshots, and
metrics. A minimized box tombstone, lifecycle summaries, and abuse flags remain
for 180 days for support, security, and claim handling. Paid billing evidence
remains for six calendar years for accounting; a specific dispute or legal hold
may extend one record. Account deletion pseudonymizes retained links and removes
the account tombstone once no retained record still refers to it.
