# Design Convex Controller

Source: https://chatgpt.com/share/6aa6f4f5-c9e8-83ed-9a88-66166e5330be

---

## Turn 1: User

_2026-09-13T19:03:47.427Z_

Design a minimal durable infrastructure controller on Convex 1.45.0 with TypeScript. Existing tables are servers {slug}, serverSlugs {slug, serverId}, and serverMembers {serverId, userId, role: owner|write|read}. A separate users table mirrors Clerk. Proposed additions are server allocations and durable operations. Hetzner is the first backend, with a future VM pool on dedicated hosts. No frontend or billing yet.

Read current official Convex documentation and official component source. Compare Workpool with Workflow for this concrete lifecycle. The local project guidelines require Workpool for bounded action concurrency, and retries only for idempotent actions. Distinguish database transaction guarantees, durable enqueueing, callback behavior, action side effects, and provider idempotency. Analyze process failure at every boundary between saving intent, claiming work, submitting to the provider, persisting the result, and completing callbacks. Cover stale workers, cancellation, delete-during-create, reconciliation, retry backoff, cleanup starvation, per-user admission versus shared API pacing, and bounded inventory scans. Explain what happens when callbacks fail or old queued work runs after code deployment.

Return a recommendation, minimal tables and indexes, state-transition invariants, and a crash-point matrix. Explain where exactly-once external creation is not provable and how to fail safely. Avoid unnecessary components, unbounded arrays/scans, and claims that a lease cancels an external request. Cite primary sources and identify version mismatches. No committed test framework or full code implementation is needed.

---

## Turn 2: ChatGPT

_2026-09-13T19:03:48.767Z_

I’ll ground this in the current Convex docs plus the official Workpool/Workflow component source, then map those guarantees onto your server-allocation lifecycle and failure boundaries. I’ll call out where today’s docs/source differ from a Convex 1.45.0 project assumption rather than silently treating “latest” behavior as 1.45.0 behavior.

---

## Turn 3: ChatGPT

_2026-09-13T19:03:59.557Z_

A key distinction is already clear from the primary docs: Convex gives atomic “save intent + enqueue” only when both happen inside the same mutation; actions sit outside that transaction boundary and are not automatically retry-safe. For this controller, that pushes provider calls into narrowly scoped Workpool actions and keeps authoritative lifecycle state in your own tables, rather than making a Workflow journal the source of truth.

---

## Turn 4: ChatGPT

_2026-09-13T19:07:46.768Z_

## Recommendation

Use **one Workpool-backed provider queue plus your own durable allocation/operation state machine**. Do **not** add Workflow for this lifecycle yet.

The reason is architectural rather than stylistic. Your durable truth must already live in application tables because a cloud API call can succeed while the Convex action dies before recording the result. Workflow can durably journal Convex steps and replay orchestration, but it cannot turn a third-party `POST /servers` into a distributed transaction. It would therefore duplicate much of the state you still need for reconciliation, while introducing replay/versioning constraints and extra cleanup. Workflow itself uses Workpool underneath. ([GitHub](https://raw.githubusercontent.com/get-convex/workflow/main/README.md))

A good minimal shape is:

**mutation: save desired state + operation + enqueue → Workpool action: claim → provider call → mutation: record observation/result → optional Workpool callback for wake-up/failure bookkeeping → reconciliation as the backstop.**

Crucially, the callback is **not** a correctness boundary.

### Why Workpool fits better than Workflow

| Concern | Workpool | Workflow | This controller |
|---|---|---|---|
| Bound external-action concurrency | Direct purpose of component | Uses Workpool internally | **Need this** |
| Durable multi-step journal/replay | No | Yes | Not necessary yet |
| Explicit durable domain state | You provide it | Still needed for provider uncertainty | **Need this anyway** |
| Action retries | Configurable, default off; docs explicitly warn to retry only idempotent actions | Same underlying model, configurable by step | **Retry selectively** |
| Long sleeps/events/human approval | Basic delayed work | Excellent | No current need |
| Deploy-time replay compatibility | Queued call must accept old args | More restrictive: handler replays journal, step name/arguments/order matter | Workpool simpler |
| Cancellation | Prevents pending/retry work; running action keeps running | Stops workflow progress; running actions keep running | Neither cancels Hetzner |
| Storage cleanup | Component-managed work records | Workflow histories require cleanup | Workpool simpler |

Workpool documents `maxParallelism`, exponential backoff with jitter, completion mutations, and default-off action retries; its code comments explicitly say `retryActionsByDefault` should only be enabled for idempotent actions. Cancellation does not terminate an attempt already in progress. ([GitHub](https://raw.githubusercontent.com/get-convex/workpool/main/README.md))

Workflow is attractive when you genuinely have a durable program such as “create VM → wait for event → configure → await approval → sleep three days → do X”. Its handler is deterministically replayed from recorded steps. Current Workflow docs warn that changing arguments can cause determinism violations, and even renaming a step function can break an in-flight workflow. ([GitHub](https://raw.githubusercontent.com/get-convex/workflow/main/README.md))

For an infrastructure controller, **desired/observed state + reconciliation** is the more useful abstraction.

---

# Transaction and durability boundaries

Convex mutations are atomic and isolated. A `ctx.runMutation` performed by a mutation—including a component mutation—is part of that top-level transactional operation; writes into components commit with the caller or roll back with it. ([Convex](https://docs.convex.dev/functions/mutation-functions?utm_source=chatgpt.com))

That gives you an important guarantee for your entry point:

```text
authorize
→ create/update allocation intent
→ insert durable operation
→ await workpool.enqueueAction(...)
→ save returned workId
→ mutation commits
```

If all of those occur in the same top-level mutation and an uncaught failure occurs, you do not get “allocation intent committed but enqueue lost” or “Workpool item committed but operation row missing.” Workpool's client implements enqueue using a component mutation, and the component stores the work in its mutation. ([GitHub](https://raw.githubusercontent.com/get-convex/workpool/main/src/client/index.ts))

That guarantee ends when the action starts.

An action is **not transactional**. Every `ctx.runMutation` called by an action is a separate transaction, and arbitrary HTTP effects in between those transactions cannot participate in Convex atomicity. Convex intentionally does not automatically retry ordinary actions because it cannot know whether an external side effect occurred. ([Convex](https://docs.convex.dev/functions/actions?utm_source=chatgpt.com))

So think of the lifecycle as:

```text
Convex transaction A
    intent + op + durable enqueue
             |
             v
         action starts
             |
Convex transaction B: claim
             |
             v
       HTTP side effect        <-- no distributed transaction here
             |
             v
Convex transaction C: persist observation/result
```

The gap around the HTTP call is the central failure problem.

---

# Minimal data model

I would add exactly the two application tables you proposed.

### `serverAllocations`

One current allocation identity per logical `server`.

| Field | Purpose |
|---|---|
| `serverId` | Logical server |
| `backend` | `"hetzner"` now; `"pool"` later |
| `generation` | Incarnation/fencing number |
| `desired` | `"present" \| "absent"` |
| `phase` | `"absent" \| "allocating" \| "present" \| "deleting" \| "uncertain" \| "error"` |
| `spec` | Small resolved immutable provisioning spec for this generation |
| `providerProject` | Logical credential/project key, not a secret |
| `providerName` | Deterministic external name for this generation |
| `providerId?` | External VM/resource ID; store as string |
| `providerActionId?` | Hetzner asynchronous action ID when useful |
| `lastObservedAt?` | Reconciliation timestamp |
| `reconcileAt` | Next time it requires checking |
| `lastError?` | Small bounded structured error |

Indexes:

```text
by_server                 [serverId]
by_backend_providerId     [backend, providerId]
by_backend_providerName   [backend, providerName]
by_reconcileAt            [reconcileAt]
```

Convex indexes are not SQL `UNIQUE` constraints. Enforce “one allocation per server” by querying `by_server` and inserting/updating inside the same mutation; OCC/transaction isolation prevents two successful concurrent mutations from both observing the same old state and violating the invariant. ([Convex](https://docs.convex.dev/functions/mutation-functions?utm_source=chatgpt.com))

### `serverOperations`

This is your durable control-plane history, not a mirror of every Workpool internal attempt.

| Field | Purpose |
|---|---|
| `allocationId` | Target allocation |
| `actorUserId?` | User who initiated it; absent for maintenance |
| `kind` | `"create" \| "delete" \| "reconcile" \| "inventory"` |
| `generation` | Allocation generation it belongs to |
| `schemaVersion` | Protect old queued work across deployments |
| `state` | `"queued" \| "claimed" \| "uncertain" \| "succeeded" \| "failed" \| "canceled"` |
| `active` | Denormalized boolean for bounded admission queries |
| `claimEpoch` | Monotonic fencing token |
| `leaseExpiresAt?` | When another worker may reclaim DB ownership |
| `workId?` | Workpool work ID |
| `attemptCount` | Domain attempts/reconciliations, not necessarily identical to Workpool attempts |
| `nextAttemptAt?` | Backoff/reconcile scheduling |
| `cancelRequestedAt?` | Durable cancellation intent |
| `providerRequestAt?` | Useful evidence around ambiguity |
| `lastError?` | Bounded diagnostic |

Minimal indexes:

```text
by_allocation_active      [allocationId, active]
by_actor_active           [actorUserId, active]
by_active_lease           [active, leaseExpiresAt]
by_active_nextAttempt     [active, nextAttemptAt]
```

I would **not** add an events table, lease table, queue table, reconciliation table, or Workflow journal on day one.

---

# State-transition invariants

These matter more than the exact enum names.

1. **`desired` is authoritative; `phase` is merely observed/control state.** Provider responses never implicitly change user intent.

2. **At most one active mutating operation per allocation.** Check `by_allocation_active` transactionally. A reconcile may coalesce with that operation rather than becoming another competing create/delete.

3. **An allocation generation identifies one external incarnation.** Only increment it after the previous incarnation is known absent and you intend a genuinely new allocation. Do not bump merely because `desired` goes `present → absent`.

4. **Every state-changing worker is fenced by `(allocationId, generation, claimEpoch)`.** Its result mutation must verify all three before making authoritative state transitions.

5. **A lease is permission to take over DB work, not cancellation of external work.** An expired worker may still have an outstanding Hetzner HTTP request.

6. **Never clear `providerId` because deletion was requested.** Clear it only after provider absence is positively observed—normally a successful terminal action/GET, or a trustworthy 404 for the exact resource.

7. **Never conclude “not created” merely because the create action failed or timed out.** Network failure after request submission is `uncertain`.

8. **A stale create result may still reveal useful external identity.** Fencing should prevent it from declaring the allocation `present`, but do not throw away evidence that a resource exists. Record/adopt it through a reconciliation-safe path and, if `desired === "absent"`, delete it.

9. **No old generation may delete or adopt the new generation's resource.** Provider names and labels must contain the generation/opaque allocation identity.

10. **Terminal operation state must not be required to infer actual provider state.** The allocation and future reconciliation remain authoritative.

---

# The Hetzner creation protocol

Hetzner is asynchronous: mutating requests can return an Action that remains `running`, and Hetzner recommends waiting for `success`/`error` without aggressive polling. The API is also rate limited per project; its current documented default is 3,600 requests/hour/project, with `RateLimit-*` headers. Listings are paginated, normally with a maximum `per_page` of 50. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

For create, use a deterministic external identity such as:

```text
providerName = "ctl-" + stableAllocationToken + "-g" + generation
labels = {
  "yourdomain/controller": "servers",
  "yourdomain/allocation": stableAllocationToken,
  "yourdomain/generation": generation
}
```

Do not base identity solely on mutable `server.slug`.

Hetzner's official Python client documents that server names must be unique per project and supports exact lookup by name; labels can also be filtered server-side. ([GitHub](https://raw.githubusercontent.com/hetznercloud/hcloud-python/main/hcloud/servers/client.py))

That lets you turn create into an **idempotency protocol**, although Hetzner is not giving you a general-purpose `Idempotency-Key` transaction:

1. Exact lookup of the deterministic name.
2. If found, verify your ownership labels/generation and adopt it.
3. Otherwise submit `POST /servers` using that same name and labels.
4. If the response arrives, immediately persist `server.id` and the returned Action ID. Do not spend a long action polling before saving that identity.
5. If the POST has an ambiguous transport result, mark the operation `uncertain`.
6. On retry/reconciliation, look up the deterministic name first.
7. If a repeated POST races with the original and gets Hetzner's `409 uniqueness_error`, look up the existing name and verify its labels before adopting it. A name collision without matching controller labels is **not success**; stop in `error/needs-attention`.

Hetzner documents `409 uniqueness_error`, `429 rate_limit_exceeded`, transient 5xx classes, asynchronous Actions, labels, and label selectors. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

This is substantially safer than blind POST retries.

### Exactly-once is still not provable

There is no atomic transaction spanning:

```text
Convex commit <-> HTTPS request <-> Hetzner resource creation.
```

If the process dies after bytes are accepted by Hetzner but before Convex receives/persists the response, Convex cannot know from local state whether creation occurred.

With a deterministic **provider-enforced unique name**, you can make retries converge on at most one resource *under Hetzner's uniqueness contract*. That is very useful, but I would still describe the property as:

> **recoverably idempotent creation by external unique identity**, not “exactly-once cloud creation.”

That distinction remains important for the future VM-pool backend as well. A pool allocation that consists only of claiming an inventory row inside one Convex mutation can be exactly-once at the **database assignment** level; subsequent boot/configuration APIs again cross an external-effect boundary.

---

# Create/delete lifecycle

A create action should be deliberately short.

```text
claim mutation
→ preflight: is generation current and desired=present?
→ exact-name provider lookup
→ adopt OR POST create
→ persist providerId/actionId immediately
→ return
```

A separate retryable **read/status** action observes the Hetzner Action later. Reads are naturally idempotent.

For deletion:

```text
desired := absent   // mutation, immediately
→ enqueue ensureAbsent
→ claim
→ GET known providerId/name
→ if absent: record absent
→ if present: DELETE
→ later GET/reconcile until absence confirmed
```

“Ensure absent” is much easier to make retry-safe than raw “DELETE exactly once”: after an ambiguous DELETE, first observe; 404 means the desired state has been achieved, while an existing matching resource can safely receive another delete request.

### Delete during create

There are three races:

**Before POST:** the create worker's preflight sees `desired=absent` and exits.

**After preflight, before/during POST:** you cannot stop the request merely by canceling Workpool or expiring a lease. The provider may create the VM.

**After provider creation:** persist/adopt the returned resource identity even though desired state is now absent, then enqueue/continue `ensureAbsent`.

Do **not** increment the allocation generation simply when delete is requested; otherwise you risk making the result of the in-flight create look unrelated and losing the identity of the resource you now need to clean up.

Only start generation `g+1` after `g` is positively absent.

---

# Claiming, leases, and stale workers

The claim mutation should roughly do:

```text
if op is terminal -> no claim
if generation != allocation.generation -> stale
if current claim is live -> already claimed

claimEpoch += 1
leaseExpiresAt = now + bounded interval
state = claimed
return immutable work snapshot
```

Every result mutation includes that `claimEpoch`.

If worker A stalls, worker B may later take claim epoch 8 after A held epoch 7. A's eventual database result is rejected.

What fencing **cannot** do is unsend A's already-issued HTTP request. If A POSTed a VM and B takes over, B must reconcile the shared deterministic provider identity. This is why external idempotency/reconciliation and DB leases solve different problems.

Workpool itself also rejects stale completion attempts internally by comparing the completion's attempt number with the current work attempt. That's useful component hygiene but does not replace your provider-level fencing. ([GitHub](https://raw.githubusercontent.com/get-convex/workpool/main/src/component/complete.ts))

---

# Cancellation

Treat cancellation as changing **desired controller behavior**, not reversing time.

A user delete/cancel mutation should atomically:

```text
desired = absent
cancelRequestedAt = now
possibly pool.cancel(workId)
enqueue/ensure cleanup if necessary
```

Workpool explicitly says cancel avoids starting/retrying pending work but **does not stop work already in progress**. Workflow says the same for running action steps. Convex's own scheduler has the same fundamental property for an already-started scheduled action. ([GitHub](https://raw.githubusercontent.com/get-convex/workpool/main/README.md))

Therefore a canceled create may end in:

```text
Hetzner VM exists
+
controller desired=absent
+
cleanup pending
```

That is a normal recoverable state, not an invariant violation.

---

# Callbacks are a notification mechanism, not the commit point

Workpool's public README says an `onComplete` mutation is invoked on terminal success/failure/cancel unless excluded. Failed attempts that will retry do not invoke it. ([GitHub](https://raw.githubusercontent.com/get-convex/workpool/main/README.md))

The current **0.4.12 source** adds an important qualification. Terminal completion attempts to run/schedule `onComplete`, catches callback/scheduling errors, logs them, contains a TODO to store such failures for debugging, and then deletes the terminal `work` document. ([GitHub](https://raw.githubusercontent.com/get-convex/workpool/main/src/component/complete.ts))

So I would make `onComplete` idempotent and useful, but nonessential:

- action success should already have written the meaningful provider result itself;
- callback failure/cancel can mark the operation due for reconciliation;
- a periodic indexed sweeper finds `active` operations whose lease/`nextAttemptAt` is stale even if the callback never succeeded.

Workflow's current implementation is a little stronger operationally here: if its overall `onComplete` mutation throws, it catches that and writes an `onCompleteFailures` record. But that benefit alone is not enough to justify adopting Workflow. ([GitHub](https://raw.githubusercontent.com/get-convex/workflow/main/src/component/workflow.ts))

---

# Retry policy and pacing

Configure the provider Workpool with `retryActionsByDefault: false`.

Then classify actions:

| Action | Automatic retry? | Reason |
|---|---:|---|
| Exact GET by ID/name | Yes | Idempotent read |
| Check Hetzner Action | Yes | Idempotent read |
| Inventory page | Yes | Idempotent read |
| `ensureAbsent` | Yes, once protocol handles 404/ambiguous DELETE | Convergent desired-state operation |
| Raw create POST | **No** | Not inherently idempotent |
| `ensurePresent` with deterministic unique-name lookup/adoption protocol | Yes, finite | Protocol makes repetition safe under provider uniqueness |
| Arbitrary future provider action | Off until proven idempotent | Default-safe |

Workpool's retries use exponential backoff and jitter. ([GitHub](https://raw.githubusercontent.com/get-convex/workpool/main/README.md))

Use finite attempts. After exhaustion, transition to `uncertain` and let reconciliation continue at a slower cadence rather than pounding the API forever.

### 429s

Workpool limits **concurrent executions**, not requests/hour.

Hetzner's limit is project-wide API pacing, so `maxParallelism=4` does not mean “four requests per second” or guarantee staying under 3,600/hour. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

For the minimal version:

- keep one shared Hetzner Workpool with conservative parallelism;
- keep each action to a bounded number of provider calls;
- classify 429 as retryable only for idempotent/convergent actions;
- use exponential backoff;
- observe `RateLimit-Remaining`/`RateLimit-Reset`.

If real load later requires precise token-bucket pacing, add that explicitly. Don't pretend Workpool's concurrency setting is a rate limiter.

---

# Per-user admission vs shared provider pacing

These are separate controls.

**Admission** happens transactionally before creating the operation. Require `owner|write` membership and query:

```text
serverOperations.by_actor_active(actorUserId, true).take(USER_LIMIT + 1)
```

Reject/defer once a small per-user active-operation cap is reached. This prevents one user from creating an arbitrarily large backlog without scanning all operations.

**Pacing** happens in the one shared provider Workpool. Every user's Hetzner API work competes for the same bounded provider capacity.

Do not create one Workpool per user. Besides component overhead, that would defeat the global bound and allow aggregate concurrency to scale with user count. Workpool itself cautions against creating excessive pools. ([GitHub](https://raw.githubusercontent.com/get-convex/workpool/main/README.md))

---

# Reconciliation and cleanup starvation

Reconciliation is what makes the controller durable rather than merely queued.

Use two forms:

**Targeted reconciliation** for any `uncertain` allocation: look up its exact provider ID or deterministic name.

**Inventory reconciliation** periodically lists all controller-owned resources by label to discover orphans/manual drift.

Hetzner supports label selectors and paginated listings, with a documented general maximum page size of 50. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

Never enqueue “one job per every VM” from an unbounded `.collect()`.

Instead:

```text
cron/scheduled mutation
→ take at most N due allocations from by_reconcileAt
→ enqueue at most N Workpool jobs

inventory scan
→ fetch exactly one provider page (<= 50)
→ mutation processes that bounded page
→ enqueue next page if present and scan budget remains
```

Give each sweep a hard `maxPages` budget. If inventory exceeds the budget, resume on the next scheduled run rather than constructing an arbitrarily long queue.

Convex itself recommends indexed/paginated/bounded database work, and current limits explicitly bound transactions/scheduling. ([Convex](https://docs.convex.dev/understanding/best-practices?utm_source=chatgpt.com))

### Avoiding cleanup starvation

I would initially keep **one** Hetzner provider pool, not separate “interactive” and “cleanup” pools. Two pools have separate parallelism controls, so they no longer give you one clean global API concurrency cap.

Instead:

- enforce small per-user active limits;
- enqueue only bounded reconciliation pages;
- make overdue cleanup visible through `reconcileAt`;
- when cleanup debt exceeds a small threshold, admission can temporarily stop accepting additional creates while deletes/reconciliation catch up.

If sustained production load later genuinely requires priority isolation, two pools can be justified—but then explicitly budget their **combined** concurrency/API rate. It is not minimal infrastructure anymore.

---

# Crash-point matrix

| Crash/failure boundary | Durable state afterward | Risk | Recovery / required invariant |
|---|---|---|---|
| Before initiating mutation commits | Nothing | None | Client may retry mutation |
| Allocation/op written in mutation, then enqueue throws | Entire top-level mutation rolls back | None | Save intent and Workpool enqueue in same mutation |
| Workpool enqueue succeeds internally, outer mutation later throws | Component and app writes roll back together | None | Component mutation participates in top-level mutation transaction ([Convex](https://docs.convex.dev/components/using?utm_source=chatgpt.com)) |
| Mutation commits, job not yet started | Intent + durable Workpool item | Delay only | Workpool/scheduler durability |
| Job starts, dies before claim | Op still queued | Temporary stall | Workpool retry only if allowed; sweeper sees overdue op |
| Claim commits, dies before HTTP | Live/stale lease | No external effect | Lease expiry allows new claim |
| HTTP request is being submitted, process disappears | `claimed`, external state unknown | **Ambiguous creation/deletion** | Set/reconcile `uncertain`; lease does not cancel request |
| Hetzner accepted create, response lost | DB lacks provider ID, VM may exist | Duplicate if blindly POSTed | Deterministic unique name + lookup/adopt before retry |
| Response received, dies before result mutation | Same as above | VM exists but DB doesn't know | Exact-name/label reconciliation |
| Result mutation throws/rolls back | Provider changed, Convex didn't | External orphan/unknown | Reconcile; never infer rollback of provider |
| Result mutation commits, action dies before returning | DB already knows result | Workpool could retry action | Worker protocol must detect already-applied result/adopt existing resource; only retry idempotent action |
| Action succeeds, Workpool completion processing delayed | Domain state already correct | Bookkeeping lag | Domain state does not depend on callback |
| Workpool callback scheduling/execution fails | Domain result should remain correct; op may stay active | Stuck bookkeeping | Indexed stale-op sweeper; do not rely solely on callback ([GitHub](https://raw.githubusercontent.com/get-convex/workpool/main/src/component/complete.ts)) |
| Cancel before action starts | Desired state changed; Workpool can become canceled | None externally | Callback/sweeper closes operation |
| Cancel while HTTP action runs | External request continues | VM may still appear/disappear | Desired-state reconciliation cleans up |
| Lease expires while old worker is alive | New worker may start while old HTTP request continues | Concurrent external attempts | `claimEpoch` fences DB results; external deterministic identity prevents duplication |
| Delete arrives while create queued | `desired=absent` | None if preflight occurs | Create exits without provider call |
| Delete arrives after create POST | Desired absent, create may complete | Temporary unwanted resource | Adopt returned/discovered ID and `ensureAbsent` |
| Reconciliation page crashes before persistence | No observation update | Repeated read | Repeat page; read is idempotent |
| Reconciliation page persists then continuation is lost | Partially progressed scan | Delayed remaining inventory | Next periodic bounded sweep starts/resumes |
| Deployment happens while work is queued | Old arguments, **new code** | Semantic/version mismatch | `schemaVersion` gate and backwards-compatible validators/handlers |

---

# Old queued work after deployment

This deserves explicit treatment.

Convex states that a scheduled function always executes its **currently deployed function version**, even if it was scheduled under an older deployment. Therefore scheduled functions must remain backwards-compatible with old arguments. ([Convex](https://docs.convex.dev/production/overview?utm_source=chatgpt.com))

Workpool ultimately dispatches work through Convex scheduling machinery, so don't assume an enqueued operation captures a code snapshot.

Put a small integer such as:

```text
schemaVersion: 1
```

in every operation/job argument, and have the current handler do something like:

```text
switch (schemaVersion) {
  case 1:
    // retain old semantics
    break;
  default:
    // do NOT guess
    markNeedsReconciliation(...)
}
```

Also persist the **resolved provisioning spec** needed to interpret an old create. Do not make old intents depend on whatever the current environment/default server type happens to be.

This is another reason Workpool is preferable here. Workflow has additional replay constraints: current Workflow docs validate replayed step arguments against its journal and warn that renamed functions can make an in-flight workflow fail. ([GitHub](https://raw.githubusercontent.com/get-convex/workflow/main/README.md))

---

# Component/version notes

As of **September 13, 2026**, `convex@1.45.0` is in fact the npm `latest`, so your requested Convex version is not stale. ([npm](https://www.npmjs.com/package/convex?activeTab=versions&utm_source=chatgpt.com))

The current official component sources I reviewed have a small test-version mismatch worth recording:

- **Workpool main is 0.4.12**. Its peer requirement is `convex ^1.36.1`, so 1.45.0 is semver-compatible, but its repository's dev dependency currently pins Convex **1.43.0**. ([GitHub](https://raw.githubusercontent.com/get-convex/workpool/main/package.json))
- **Workflow main is 0.4.7**. It peers on `convex ^1.36.1` and `@convex-dev/workpool ^0.4.4`, while its repository currently develops/tests against Convex **1.43.0** and Workpool **0.4.7**. ([GitHub](https://raw.githubusercontent.com/get-convex/workflow/main/package.json))

So the current source is compatible *by declared peer ranges* with Convex 1.45.0, but don't describe it as having been repository-tested specifically against 1.45.0 based on those package files.

Also pin your actual component versions in the lockfile and review the corresponding tag, especially before depending on source-level callback behavior.

---

## Bottom line

The smallest design I would ship is **two domain tables, one shared provider Workpool, one bounded reconciliation cron, and no Workflow**.

The safety model is:

```text
Convex mutation = exactly/atomically record desired intent and durable enqueue
Workpool        = bounded execution and selective retries
claimEpoch      = fence stale workers' DB writes
provider name   = stable external identity
reconciliation  = resolve ambiguous external outcomes
desired state   = make cancellation/delete convergent
```

Do not try to prove “one action invocation means one Hetzner VM.” You cannot. Prove the narrower properties that matter: **one current logical allocation per server, stale workers cannot overwrite current state, retries cannot intentionally manufacture a second provider identity, ambiguous outcomes become `uncertain` rather than false success/absence, and reconciliation eventually drives observed state toward desired state.**
