---
title: Web operations
description: Admin bootstrap, role boundaries, capacity admission, and incident runbooks for the hosted service.
---

This is the operator runbook for the hosted Composery service. Provider setup
belongs under [Services](./services/index.md); hardcoded cron and retention
values are in [Maintenance](./maintenance.md).

## Admin, staff, and owner terminology

These words are not interchangeable:

| Term                   | Meaning in this project                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `user`                 | Stored application role for an ordinary customer                                                                 |
| `admin`                | Stored application role with every current internal capability                                                   |
| staff                  | Collective name for internal console surfaces and backend modules; it is not a stored role                       |
| box owner              | Customer whose Clerk user ID equals a box's `user_id`; ownership checks grant access only to that customer's box |
| provider account owner | External GitHub/Hetzner/Polar/Resend/etc. organization owner; Composery cannot grant or transfer it              |

V1 intentionally stores only `user` and `admin`. Calling every employee generic
`staff` would make it too easy to grant customer deletion, fleet operations,
billing intervention, settings changes, and alert access as one implied bundle.
It is also unnecessary to invent narrow roles before real people need them.

Instead, `convex/roles.ts` explicitly maps roles to capabilities:

- `staff_console` - enter and read the console;
- `box_operations` - operate customer boxes, snapshots, and flags;
- `user_moderation` - suspend or delete customer accounts;
- `settings_management` - checkout, capacity, snapshot, and abuse settings;
- `checkout_management` - release active checkout reservations;
- `staff_alerts` - receive Resend operational alerts.

Today `admin` has all six and `user` has none. Backend functions check the
specific capability; the console link checks `staff_console`. Suspension removes
all capability access. Merely being a non-user role never grants access.

### Add a narrower role later

When the company has a real need such as support staff who may inspect boxes but
not delete accounts or change billing settings:

1. Add the role literal to `vUserRole` in `convex/schema.ts`.
2. Add an explicit capability entry to `ROLE_CAPABILITIES` in
   `convex/roles.ts`. Typechecking deliberately fails until this is done.
3. Audit every backend endpoint for the narrow capability it requires; never
   replace this with `role !== "user"`.
4. Gate console controls as well as navigation. Backend denial is the security
   boundary, but controls the person cannot use should not be displayed.
5. Decide whether the role receives `staff_alerts`, may act on other internal
   accounts, and may be promoted by an admin. Do not infer these powers.
6. Add role/capability, action-denial, UI, migration, and alert-recipient tests.
7. Document the role and assign it only after the production deployment is on
   the new code/schema.

## Bootstrap the first admin

There is deliberately no public “make me admin” route and no email allowlist.
That would turn a configuration mistake into privilege escalation.

1. Deploy Convex and Clerk for the environment.
2. Sign in once with the exact founder/operator Clerk identity. The app creates
   a `users` row with role `user`.
3. In the matching Convex deployment dashboard, open **Data** -> **users**.
4. Match the row by its exact Clerk user ID and email. Change only `role` from
   `user` to `admin`.
5. Refresh the site and open `/console`. Confirm the console link appears and a
   read-only page load succeeds.
6. Repeat separately for development and production; their databases and roles
   are independent.

For later admins, use the same out-of-band process until a reviewed invitation
and role-management flow exists. Before demoting the last admin, promote and
test the replacement. Application-admin changes should be paired with provider
access reviews, because an admin does not automatically own Convex, Hetzner,
Polar, Resend, Vercel, DNS, or GitHub.

## Capacity and paid checkout

Hetzner shows approved account limits in its Console **Limits** tab; the Cloud
API does not expose an authoritative maximum. Some approved limits span
projects. Composery therefore stores an operator-entered **deployment
allocation**, not a discovered quota and not an invented safety percentage.

In `/console`, enter both:

- **Server allocation**: maximum server slots this Convex deployment may commit.
- **Snapshot allocation**: maximum snapshot slots this deployment may commit.

If dev and prod use different projects under one Hetzner account, choose the
allocations so their sum stays within the account's approved limits. Leave
operational headroom by allocating less than the approved value if desired;
make that a conscious account plan, not hidden arithmetic in code. Checkout
fails closed until both allocations are configured.

One live box commits one server slot and its full configured snapshot package
(`manualCap + automaticCap`). One active unpaid checkout commits the same
package. Existing snapshots count directly; each live box also reserves its
unused entitlement. Deleting/failed snapshot rows with a Hetzner image still
count until the image is gone, and tracked images left by a deleted box count as
remnants. This makes the accounting conservative across asynchronous cleanup.

New checkout is admitted only when one complete package fits in both
allocations. Convex mutation serialization prevents simultaneous reservation
writes from both observing and taking the final slot. An active checkout can be
resumed even when later reservations are blocked. Its one-hour expiry releases
the slug and capacity automatically.

Existing boxes always have priority. Lowering an allocation below current
commitments does not delete or suspend them; it reports an overcommit and blocks
new checkout. Raising an allocation or removing resources causes calculated
capacity to reopen automatically. The separate checkout toggle remains a manual
pause and never re-enables itself.

Changing the snapshot policy recalculates the full fleet commitment. A change
that would worsen an overcommit is rejected until the allocation is increased;
a change that reduces commitments is allowed. Reducing a cap does not instantly
delete customer-created snapshots—normal retention/cleanup owns deletion—so the
console may remain overcommitted until cleanup finishes.

### Paid race and provider rejection

A paid webhook can arrive after its original reservation expired. Fulfillment
must reacquire one complete package. If it cannot, Composery does not create an
unallocated box: it revokes the subscription, refunds the remaining refundable
initial order amount, records an idempotent unfulfilled result, and creates a
durable staff alert. Production Resend setup delivers that alert by email; the
console exposes any queue or delivery problem.

Hetzner remains authoritative. A `resource_limit_exceeded` response during
server or snapshot creation manually pauses checkout as a circuit breaker even
when the entered allocation appeared available. This covers stale values,
shared-account consumption, and provider-side changes. Dynamic plan/location
unavailability tries the configured placement candidates and does not by itself
rewrite the allocation.

Calculated server/snapshot exhaustion opens one deduplicated alert episode and
recovery closes it. The independent checkout toggle sends an alert on every
actual state transition, including a provider-triggered circuit breaker. The
complete alert boundary lives in [Resend](./services/resend.md#alert-policy).

## Capacity incident runbook

1. Leave existing boxes alone; they own the first claim on committed capacity.
2. Confirm whether checkout is blocked by calculated server capacity,
   calculated snapshot capacity, or the manual checkout toggle.
3. Compare the console commitments with the correct Hetzner account Limits tab
   and project resources. Include the other environment when limits are shared.
4. Inspect active checkout reservations and let valid customers resume. Release
   only clearly abandoned/stuck reservations; normal expiry is the default.
5. Inspect failed/deleting snapshots and reconciliation logs before deleting
   anything manually. Never remove a customer snapshot solely to make a sale.
6. If Hetzner rejected a request, request/verify the provider limit increase or
   reduce the deployment allocation to the real available amount.
7. Update both deployment allocations when the account plan changes. Re-enable
   the manual checkout toggle only after a disposable create/delete or other
   provider check proves the failure is cleared.
8. Reconcile any paid-unfulfilled order in Polar and Convex; confirm revocation,
   refund, deletion cleanup, and webhook/reconciliation completion.

## Routine checks

- Review `/console` for failed operations, abuse flags, capacity commitments,
  active checkout reservations, and disabled checkout/auto-suspend toggles.
- Review Convex function and cron failures, Polar webhook deliveries, Hetzner
  actions/resources/limits, Cloudflare records, and Vercel production health.
- Confirm Polar owns customer billing email and Resend delivery is healthy and
  staff-only. See [Resend](./services/resend.md).
- Before changing destructive behavior, read the deletion, retention, refund,
  and reconciliation sections in [Polar](./services/polar.md),
  [Hetzner](./services/hetzner.md), and [Maintenance](./maintenance.md).
