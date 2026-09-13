# Billing Provisioning Boundary

Source: https://chatgpt.com/share/6aa6f4fd-cc50-83ed-8a9b-e837c9c765f5

---

**User**

Research the boundary between billing and provisioning for a Convex VPS product. We plan to implement a durable Hetzner server lifecycle first, with operator-controlled provisioning grants and resource ceilings. Later billing may use Stripe or Polar; selecting the vendor is not this task. A user can own multiple servers, transfer ownership if supported, and retain old allocations when new purchases switch to a different hosting backend.

Explain the minimum allocation eligibility contract needed now. For later billing, cover duplicate and out-of-order events, authoritative reconciliation, payment success plus provisioning failure, cancellation during creation, continued provider charges while powered off, failed deletion, plan changes, refunds, disputes, grace periods, and ownership transfer. Distinguish desired access, billable entitlement, provider allocation, and payment records. Use official provider documentation where behavior is vendor-specific, and do not invent identical event semantics across vendors.

Return the small present-day interface and the later event/state mapping, with clear invariants that prevent duplicate allocations and abandoned charges. Identify which decisions must wait for an actual billing model. Avoid a speculative ledger implementation. Cite primary sources and label policy recommendations separately from facts.

---

**ChatGPT**

I’ll separate the durable hosting lifecycle from any future billing vendor, then map Stripe/Polar-specific facts only where their docs actually guarantee behavior. I’ll keep the present-day contract intentionally small and put policy choices in a separate section so the design doesn’t accidentally hard-code a billing model.

---

**ChatGPT**

A key boundary is emerging: provisioning cannot safely depend on a boolean “paid/allowed” check. It needs an atomic, durable **claim of one allocation slot** keyed by the logical server ID; otherwise retries, concurrent creates, and later webhook replays can all create a second Hetzner server.

---

**ChatGPT**

The provider side reinforces that separation. Hetzner bills a cloud server for as long as it exists—even when powered off—and separately bills resources such as Primary IPv4s; deletion, not shutdown, is what stops those charges. Its API also exposes labels and label filtering, which gives you a practical recovery key for ambiguous create calls.

---

**ChatGPT**

The clean boundary is: **billing decides whether an allocation may exist; provisioning decides whether a concrete provider resource does exist.** Do not make provider resources themselves the billing record, and do not let billing webhooks call Hetzner directly.

## Recommended model

Keep four concepts separate:

| Concept | Answers | Owns |
|---|---|---|
| **Desired access** | “Does the product/user currently want this logical server to exist?” | `serverId`, `ownerId`, requested shape, `desiredState = present/absent` |
| **Billable entitlement** | “Is there an eligible allocation slot for this server, under what ceiling?” | grant/entitlement ID, limits, validity, fulfillment class |
| **Provider allocation** | “What billable infrastructure actually exists?” | backend, Hetzner server ID, IP/resource IDs, lifecycle state |
| **Payment records** | “What did the billing provider charge/refund/dispute?” | Stripe/Polar customer/subscription/invoice/order/payment/refund IDs and current observed status |

The separation matters because none of these states implies the others. A customer can have a valid paid entitlement with provisioning temporarily failed; a Hetzner allocation can continue costing money after entitlement is revoked; a refund need not revoke a subscription; and a server can be powered off while still fully billable.

Hetzner explicitly bills cloud servers for as long as they exist, regardless of power state. Primary IPs are billed separately while they exist as well. Hetzner also exposes asynchronous actions and resource labels/filtering through its API. ([Hetzner Docs](https://docs.hetzner.com/cloud/billing/faq/?utm_source=chatgpt.com))

---

# 1. Minimum contract to implement now

I would not introduce a billing abstraction yet. Introduce an **allocation grant + atomic claim** abstraction.

```ts
type ServerSpec = {
  vcpu: number;
  memoryMiB: number;
  diskGiB: number;
};

type AllocationClaimResult =
  | {
      ok: true;
      grantId: string;
      claimId: string;
      fulfillmentClass: string; // today: "hetzner-v1"
    }
  | {
      ok: false;
      reason:
        | "no_active_grant"
        | "allocation_limit_reached"
        | "resource_ceiling_exceeded";
    };

interface AllocationEligibility {
  /**
   * Atomic and idempotent by serverId.
   *
   * A successful claim consumes capacity until the corresponding
   * provider allocation has been confirmed absent.
   */
  claim(input: {
    ownerId: string;
    serverId: string; // stable logical server ID
    spec: ServerSpec;
  }): Promise<AllocationClaimResult>;

  /**
   * Called by the lifecycle controller, not directly by UI/billing.
   * Only valid after all chargeable provider resources for this
   * allocation have been confirmed absent.
   */
  releaseAfterProviderAbsent(input: {
    serverId: string;
  }): Promise<void>;
}
```

And the current operator-controlled grant can stay extremely small:

```ts
type ProvisioningGrant = {
  id: string;
  subjectId: string;          // user/account
  enabled: boolean;

  maxAllocations: number;     // supports multiple servers

  perServerCeiling: {
    vcpu: number;
    memoryMiB: number;
    diskGiB: number;
  };

  fulfillmentClass: string;   // "hetzner-v1" today
};
```

If operator policy needs an aggregate CPU/RAM/disk budget across all servers, add aggregate ceilings to this same grant. Otherwise, don't introduce them merely because a future billing plan *might* need them.

### Why `claim()`, not `isEligible(): boolean`

A check followed by provisioning has a race:

```text
check capacity       -> yes
check capacity       -> yes
create server A
create server B
```

The claim must be created in the same durable transaction that verifies the grant's remaining capacity. `serverId` is the idempotency identity: calling `claim()` repeatedly for the same logical server returns the existing claim rather than consuming another slot.

That is the most important boundary to get right now.

---

# 2. Present-day Hetzner lifecycle

The durable lifecycle should look roughly like:

```text
desired server
    │
    ▼
atomic allocation claim
    │
    ▼
provider allocation: creating
    │
    ├── Hetzner create/reconcile
    ▼
ready
    │
    │ delete requested
    ▼
deleting
    │
    ├── Hetzner delete/reconcile
    ▼
confirmed absent
    │
    ▼
release allocation claim
```

### Policy recommendation

Before making the Hetzner create request, persist the logical `serverId`, claimed grant, selected `fulfillmentClass`, and `creating` state. Put the logical allocation identity into a Hetzner label such as:

```text
your-domain.example/allocation=<stable-id>
```

Hetzner supports user labels and server listing/filtering by labels. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

If the create request times out, **do not issue another create immediately**. First reconcile by the label. The failure mode you care about is:

```text
Hetzner created server
        ↓
network response lost
        ↓
your process retries POST create
        ↓
two billable servers
```

I would not assume a Hetzner create idempotency guarantee that isn't documented in the cited API contract. Label-based reconciliation makes the lifecycle recoverable independently of that assumption.

Similarly, deletion is not complete because your local call returned an error—or because you set `desiredState = absent`. Reconcile provider existence. Only release the allocation claim once the provider resources are actually absent.

This is particularly important because Hetzner says billing continues until the resource is deleted, and powering off a server does not stop billing. ([Hetzner Docs](https://docs.hetzner.com/cloud/billing/faq/?utm_source=chatgpt.com))

Also treat chargeable child resources explicitly. Hetzner bills Primary IPs separately while they exist; snapshots and other resources can have their own billing lifecycle. Do not equate “server gone” with “the whole provider allocation costs zero” unless your reconciler has verified the resources your provisioning code can create. ([Hetzner Docs](https://docs.hetzner.com/cloud/billing/faq/?utm_source=chatgpt.com))

---

# 3. Invariants worth enforcing in storage

These are the invariants I would make non-negotiable:

1. **One claim per logical `serverId`.** A retry never consumes another allocation slot.
2. **At most one live provider allocation for a logical server.** Any duplicate discovered during reconciliation is an incident requiring cleanup, not a second valid allocation.
3. **Claim before create.** There must never be an unclaimed provider create.
4. **Release after confirmed provider absence, never after merely requesting deletion.**
5. **Ambiguous provider create/delete responses cause reconciliation, not blind repetition.**
6. **Existing allocation backend is immutable.** `providerAllocation.backend = "hetzner"` stays Hetzner for that server unless you explicitly build migration.
7. **Power state does not represent allocation/billing state.** `off` is still `providerAllocation = present`.
8. **Billing events never directly create/delete provider resources.** They change/reconcile entitlement; the lifecycle controller reacts to the resulting state.
9. **Ownership and payment provenance are independent.** Transferring a server must not rewrite who originally purchased or paid for it.
10. **A revoked claim cannot be recycled while its old provider resource might still be costing money.**

Those invariants prevent both major failure classes: duplicate infrastructure and abandoned provider charges.

---

# 4. Later billing boundary

When billing arrives, `ProvisioningGrant` becomes one possible source of the same entitlement concept:

```text
operator grant ──────┐
                     ├──> allocation entitlement ──> claim
Stripe reconciliation┤
Polar reconciliation ┘
```

The lifecycle controller still consumes only entitlement/claim state.

A billing adapter should answer something conceptually like:

```ts
type EntitlementSnapshot = {
  externalEntitlementId: string;
  subjectId: string;

  state:
    | "active"
    | "grace"
    | "inactive";

  limits: {
    maxAllocations: number;
    perServerCeiling: ServerSpec;
  };

  fulfillmentClass: string;
};
```

This is not a ledger. It is just the current billable/access decision needed by provisioning.

Keep payment records separately as references/snapshots needed for support and reconciliation:

```ts
type BillingReference = {
  vendor: "stripe" | "polar";
  customerId: string;

  subscriptionId?: string;
  invoiceOrOrderId?: string;
  paymentId?: string;

  lastReconciledAt: number;
};
```

And retain webhook receipt IDs just long enough / durably enough to deduplicate processing. You do not need to invent balances, journal entries, or an internal accounting system.

---

# 5. Webhooks: trigger reconciliation, don't make them the authority

This is especially important because vendor semantics differ.

### Stripe facts

Stripe explicitly says webhook events can be delivered more than once and that **event delivery order is not guaranteed**. Stripe recommends recording processed event IDs and retrieving API objects when necessary rather than depending on webhook order. ([Stripe Docs](https://docs.stripe.com/webhooks?locale=en-GB&utm_source=chatgpt.com))

Stripe subscriptions and invoices can be retrieved directly through its API, so your reconciler can derive current entitlement from current provider state rather than from the order in which webhook messages happened to arrive. ([Stripe Docs](https://docs.stripe.com/api/subscriptions/retrieve?api-version=2025-06-30.preview&utm_source=chatgpt.com))

### Polar facts

Polar retries failed webhook delivery up to 10 times, so your handler must be idempotent. Polar follows the Standard Webhooks format and exposes webhook IDs/signatures. ([Polar](https://polar.sh/docs/integrate/webhooks/delivery?utm_source=chatgpt.com))

Polar documents particular **event-generation sequences** for renewals and cancellations, but I would not generalize those into a Stripe-like “all deliveries have these ordering semantics” guarantee. Polar provides a Customer State API containing current active subscriptions and granted benefits; that is a much better reconciliation source. ([Polar](https://polar.sh/docs/integrate/webhooks/events?utm_source=chatgpt.com))

### Policy recommendation

Normalize both integrations to:

```text
verified webhook received
       ↓
deduplicate receipt
       ↓
enqueue reconciliation for billing object/customer
       ↓
GET authoritative/current vendor state
       ↓
derive entitlement snapshot
       ↓
lifecycle controller converges infrastructure
```

Therefore a stale `payment_failed` event arriving after a newer successful payment cannot tear down a server merely because it happened to be processed last.

---

# 6. Later event/state mapping

| Situation | Billing/payment state | Entitlement state | Desired access | Provider behavior |
|---|---|---|---|---|
| Purchase/payment succeeds | Confirmed successful payment/order | `active` | Usually `present` once user has requested server | Claim one slot and provision |
| Subscription/order created but payment not yet successful | Pending/incomplete | **Not active merely because object exists** | No change | Do not provision |
| Payment succeeds, provisioning fails | Successful payment remains recorded | `active`, but unfulfilled | `present` | Retry the **same** logical allocation; never consume another entitlement |
| User deletes while creation is running | Billing may remain active | Entitlement can remain active | `absent` | Reconcile ambiguous creation; if server appears, delete it; release only after absence |
| Renewal fails | Delinquent/past-due semantics are vendor/config specific | `grace` or `inactive` according to product policy | Usually unchanged during grace | Keep/revoke according to entitlement policy, not raw payment event |
| Cancel at period end | No future renewal, current paid period still valid | `active` until effective end | Usually unchanged | Keep allocation until effective entitlement end unless user separately deletes |
| Immediate cancellation/revocation | Relationship ended now | `inactive` | Product policy decides whether it becomes `absent` automatically | If deprovisioning policy says so, durable deletion starts |
| Server powered off | Irrelevant to customer payment | No change | Still `present` | **Do not release claim. Hetzner still charges.** |
| Provider deletion fails | Customer entitlement may already have ended | Possibly inactive | `absent` | Keep allocation marked `deleting/error`; retry + alert because provider charges may continue |
| Upgrade/downgrade | Vendor-specific proration/effective date | Change limits only when billing change is effective | Existing server remains its logical server | Apply ceiling/rights policy; do not silently recreate on another backend |
| Refund | Money returned partly/fully | **No universal implication** | No automatic change unless policy says so | Do not delete solely because refund webhook arrived |
| Dispute/chargeback | Payment contested | Policy-defined | Policy-defined | Never infer identical Stripe/Polar behavior |
| Ownership transfer | Payment provenance remains attached to original billing objects | Requires explicit transfer policy | `ownerId` changes | Existing provider allocation can remain exactly where it is |
| New purchases move to another hosting backend | New entitlement gets new `fulfillmentClass` | Existing entitlement/allocation unchanged | Existing servers unchanged | New server → new backend; old server stays Hetzner |

---

# 7. Relevant Stripe versus Polar semantics

For **initial payment**, Stripe documents `invoice.paid` as a point where you can provision access when the subscription is active. Conversely, a newly created subscription can be `incomplete`. ([Stripe Docs](https://docs.stripe.com/billing/subscriptions/webhooks?utm_source=chatgpt.com))

Polar similarly says `subscription.created` can arrive before the subscription is active, and `order.created` may represent an unpaid/pending order. `order.paid` means payment has been received. ([Polar](https://polar.sh/docs/api-reference/webhooks/subscription.created?utm_source=chatgpt.com))

So the normalized rule should be **“billing reconciliation established an active entitlement,”** not “I saw a subscription-created event.”

For **cancellation**, both support end-of-period behavior, but the exact events differ. Stripe sets `cancel_at_period_end` and later sends `customer.subscription.deleted` when the period ends. ([Stripe Docs](https://docs.stripe.com/billing/subscriptions/cancel?utm_source=chatgpt.com)) Polar immediately emits cancellation-related events while the subscription can remain active with `cancel_at_period_end=true`, and later emits `subscription.revoked` when access actually ends. ([Polar](https://polar.sh/docs/integrate/webhooks/events?utm_source=chatgpt.com))

For **plan changes**, do not normalize provider mechanics. Stripe can apply changes immediately, create prorations, or use pending updates so the subscription change only takes effect when the associated payment succeeds. ([Stripe Docs](https://docs.stripe.com/billing/subscriptions/change-price?utm_source=chatgpt.com)) Polar currently supports `invoice`, `prorate`, and `next_period`; the first two update immediately under its documented payment rules, while `next_period` schedules the update for the next billing period. ([Polar](https://polar.sh/docs/features/subscriptions/manage?utm_source=chatgpt.com))

Your abstraction should only expose **effective entitlement before/after reconciliation**, not Stripe's or Polar's proration machinery.

---

# 8. Refunds and disputes should not directly equal deprovisioning

This is a particularly important future boundary.

Stripe has distinct refund events such as `refund.created`, `refund.updated`, and `refund.failed`; a refund is therefore its own payment state change rather than synonymous with subscription cancellation. ([Stripe Docs](https://docs.stripe.com/refunds?locale=en-GB&utm_source=chatgpt.com))

Polar is even more explicit: refunding an order associated with a subscription **does not terminate the subscription or revoke subscription access**; ending access requires canceling/revoking the subscription separately. ([Polar](https://polar.sh/docs/features/refunds?utm_source=chatgpt.com))

So:

```text
refund ≠ entitlement revoked
```

unless **your product policy** deliberately makes it so.

Disputes are also policy-sensitive. Stripe emits `charge.dispute.created`, but its automatic subscription-cancellation-on-dispute behavior is configurable rather than inherent; Stripe can be configured to cancel immediately or at period end for certain disputed payments. ([Stripe Docs](https://docs.stripe.com/disputes/responding?utm_source=chatgpt.com))

### Policy recommendation

Record the dispute/refund in payment records, reconcile the subscription/entitlement, and apply an explicit Convex policy such as:

```text
full refund + explicit service refund => revoke
partial refund                       => normally retain
open dispute                         => grace / suspend / retain
lost dispute                         => revoke
```

But **do not choose those rules yet** unless the commercial model has actually chosen them.

---

# 9. Grace periods

Do not encode “payment failed => delete now” into provisioning.

Stripe supports configurable recovery/retry behavior around failed subscription invoices, so the exact useful-access period depends on your billing configuration. ([Stripe Docs](https://docs.stripe.com/billing/subscriptions/webhooks?utm_source=chatgpt.com))

Polar explicitly models `past_due` as recoverable and supports a configurable benefit-revocation grace period; after retries are exhausted a subscription can be revoked. ([Polar](https://polar.sh/docs/api-reference/webhooks/subscription.past_due?utm_source=chatgpt.com))

The vendor-neutral entitlement state therefore benefits from the three states:

```text
active
grace
inactive
```

Provisioning only needs your decided treatment of `grace`. For a paid VPS, retaining a Hetzner allocation through a long grace period has real provider cost, so that duration is a commercial decision, not something the lifecycle layer should invent.

---

# 10. Payment succeeded but Hetzner provisioning failed

This needs to be a normal supported state, not an impossible invariant.

```text
payment            = succeeded
entitlement        = active
allocation claim   = claimed
desired access     = present
provider allocation= absent/error
```

### Policy recommendation

Keep retrying provisioning against the **same `serverId` and claim**. Surface “paid, provisioning delayed” operationally.

Do not create another entitlement, order, or allocation because the infrastructure call failed.

If provisioning ultimately cannot be fulfilled, compensation might mean a refund, account credit, delayed start date, or manual intervention. Which one is correct depends on the future billing terms. The provisioning layer should simply expose `unfulfilled entitlement` clearly enough for that policy to act.

---

# 11. Cancellation while provisioning is in progress

There are two different cancellations, and keeping them separate avoids a nasty race.

An explicit **server deletion** changes:

```text
desiredAccess = absent
```

even if provider creation is underway.

The create worker must notice that desired state has flipped. But it still must reconcile the create because the provider might have successfully created a chargeable server before the cancellation became visible.

Correct convergence is:

```text
create ambiguous/in-flight
        +
desired = absent
        ↓
find provider resource
        ├── none → finish absent
        └── exists → delete it
                        ↓
                 confirm absent
                        ↓
                  release claim
```

A **billing cancellation at period end**, in contrast, need not change desired access immediately because the entitlement can remain active through the paid period. Stripe and Polar both support such end-of-period cancellation. ([Stripe Docs](https://docs.stripe.com/billing/subscriptions/cancel?utm_source=chatgpt.com))

---

# 12. Ownership transfer

Model ownership on the logical server:

```text
LogicalServer.ownerId
```

not on the provider resource and not on the payment record.

A transfer therefore does not inherently require moving the Hetzner VM or rewriting historical payments.

Hetzner does support server transfer between Hetzner projects, subject to provider-specific effects such as currency/pricing and restrictions involving Primary IPs, but that is a provider-account operation and should not be confused with transferring a Convex VPS from Alice to Bob. ([Hetzner Docs](https://docs.hetzner.com/cloud/billing/faq/?utm_source=chatgpt.com))

### Decision that must wait

You still need to choose what happens to the **entitlement** during application ownership transfer:

```text
A. entitlement follows the server to recipient
B. recipient must provide an eligible entitlement
C. original purchaser continues paying, recipient merely operates it
D. transfers are prohibited for billed servers
```

All are plausible commercial models. Do not bake one into the Hetzner lifecycle now.

The invariant you can adopt today is simply:

> changing `ownerId` never silently destroys/recreates the provider allocation and never rewrites billing provenance.

---

# 13. Changing hosting backend later

The `fulfillmentClass` on the claim/grant is enough to handle this without migration complexity.

Example:

```text
old operator/billing grant
fulfillmentClass = "hetzner-v1"

new purchases
fulfillmentClass = "backend-b-v1"
```

When an allocation is actually created:

```ts
ProviderAllocation {
  serverId,
  backend: "hetzner",
  providerResourceId: "123456"
}
```

`backend` is then immutable for that allocation.

A later purchase being routed elsewhere does not affect any old server.

That gives you the requirement you asked for—**old allocations survive a backend switch**—without needing billing to know anything about Hetzner.

---

# 14. Decisions that should explicitly wait for the billing model

Do **not** decide these in the present provisioning work:

| Deferred decision | Why it belongs to billing/product policy |
|---|---|
| One subscription per server vs one subscription containing N server slots | Changes entitlement cardinality and purchase UX |
| Monthly subscription vs prepaid term vs one-time allocation | Changes effective entitlement dates |
| Whether an unused paid slot can be held indefinitely | Commercial policy |
| Grace-period length | Directly trades churn recovery against Hetzner cost |
| Full/partial refund effect on access | Vendors do not give this one universal meaning |
| Dispute effect on access | Stripe behavior is configurable; product risk policy matters |
| Provisioning-failure compensation | Refund vs credit vs retry depends on terms |
| Upgrade/downgrade treatment of existing servers | Could resize, grandfather, or apply only to future allocations |
| Whether backend routing follows purchase SKU, entitlement version, geography, or current global policy | Needs final product/pricing model |
| Whether entitlement transfers with server ownership | Commercial/legal question |
| Whether the payer and server owner may differ | Required before deciding transfer semantics |
| What happens to already-created servers when subscription quantity drops | Requires billing semantics for which allocation loses eligibility |

One Polar-specific consideration illustrates why this is worth postponing: Polar currently defaults to one active subscription per customer per organization unless multiple active subscriptions are enabled. That may matter a lot if the model becomes “one subscription per VPS,” but it is irrelevant if a subscription grants multiple slots. ([Polar](https://polar.sh/docs/features/subscriptions/introduction?utm_source=chatgpt.com))

That is exactly the kind of vendor/product coupling the present lifecycle should avoid.

---

## Recommended bottom line

Implement **logical server → atomic allocation claim → durable provider allocation** now.

Treat operator grants as the first producer of allocation entitlement. Make claims idempotent on `serverId`, pin a fulfillment class when the claim/allocation is created, label every Hetzner resource with that identity, and never release capacity until the provider is authoritatively absent.

Later, make Stripe or Polar an **entitlement reconciler**, not the provisioning orchestrator. Webhooks should tell you “reconcile this billing object,” not “create/delete this VM.” Stripe explicitly requires handling duplicate and out-of-order webhook delivery; Polar retries deliveries and offers authoritative customer/subscription state that can be fetched. ([Stripe Docs](https://docs.stripe.com/webhooks?locale=en-GB&utm_source=chatgpt.com))

That boundary is small enough to build now, while still covering duplicate purchase events, failed provisioning, concurrent cancellation, grace periods, backend changes, ownership transfers, and—most importantly—the two costly failure modes: **two provider allocations for one entitlement, or a provider allocation that nobody realizes is still accruing charges.**
