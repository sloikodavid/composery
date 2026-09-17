# Document Convex Guarantees

Source: https://chatgpt.com/share/6aab2bdd-562c-83ed-adbb-2c6286ec2648

---

## Turn 1: User

_2026-09-16T22:54:47.379Z_

As of September 2026, for Convex (self-hosted and cloud, version 1.45 or later), document from primary sources exactly

what is guaranteed about: scheduled functions (at-most-once, at-least-once, or exactly-once; what happens if the

deployment restarts between scheduling and running; whether a scheduled mutation can run twice), actions (whether an

action can be retried automatically, and what happens to one interrupted mid-run), the @convex-dev/workpool component's

retry and deduplication semantics, cron jobs (whether a missed run is caught up or skipped, and whether two runs can

overlap), and mutation transaction isolation and optimistic concurrency conflicts. Distinguish documented guarantees

from observed behaviour. Include GitHub issues or discussions where a user's assumption about any of these turned out to

be wrong, and say where the documentation is silent.

---

## Turn 2: ChatGPT

_2026-09-16T22:54:46.682Z_

I’ll ground this in Convex’s own docs, source/repo material, and official GitHub issues/discussions, then separate **explicit guarantees**, **implementation/observed behavior**, and **areas the docs do not promise**. I’ll also call out version-sensitive points for Convex 1.45+ and self-hosted vs cloud where they differ.

---

## Turn 3: ChatGPT

_2026-09-16T22:55:06.238Z_

A key distinction is already clear from the primary docs: **scheduled mutations are explicitly “exactly once,” while scheduled actions are explicitly “at most once.”** For ordinary actions, Convex’s rationale is that an interruption can occur after an external side effect, so Convex cannot safely infer whether retrying is correct.

---

## Turn 4: ChatGPT

_2026-09-16T22:57:43.023Z_

The important restart boundary is different for mutations and actions, so I’m checking the scheduler’s persisted state transitions rather than inferring from the words “exactly once”/“at most once.” This is also where self-hosted persistence assumptions matter.

---

## Turn 5: ChatGPT

_2026-09-16T23:05:07.544Z_

As of **September 16, 2026**, the current `convex` package is **1.45.0**, and `@convex-dev/workpool` is **0.4.12**. The core delivery semantics below are public Convex contracts; where I rely on current OSS implementation rather than a published contract, I label that separately. ([npm](https://www.npmjs.com/package/convex?activeTab=versions&utm_source=chatgpt.com))

For self-hosted Convex, these semantics assume the deployment's database actually survives the restart. Convex stores self-hosted state in SQLite by default and explicitly tells operators to use persistent storage for hosted containers; losing the database/volume is not a “restart” that the durability guarantee can cover. The self-hosted repo says it supports the cloud free-tier features and is synchronized with internal development within a handful of days, but that is not a promise that every cloud deployment runs the exact public `main` commit. ([GitHub](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md))

### Summary

| Facility | Documented delivery guarantee | Crash/restart consequence | Can user code execute more than once? |
|---|---|---|---|
| **Scheduled mutation** | **Exactly once**; transient/internal errors automatically retried | Pending schedule survives normal downtime/restart | **Yes, an attempted evaluation may be retried; no, its transaction must not commit twice** |
| **Scheduled action** | **At most once**; no automatic retry | Pending schedule survives restart; an interrupted/in-progress action is not safely replayed | **Not by the scheduler**; application/Workpool may explicitly retry it |
| **Plain action** | No automatic retries | No documented resume/replay guarantee; interruption can leave external outcome uncertain | Only if caller/application explicitly retries |
| **Workpool action** | Configurable retry attempts; default is no action retries | Workpool has recovery machinery for server failures/restarts | **Yes when retries are enabled**; external effects must be idempotent |
| **Cron occurrence** | Mutation/action semantics above; **≤1 run of the same cron concurrently** | Public docs permit missed runs to be skipped | Current implementation does not replay every missed tick |
| **Mutation transaction** | Atomic + **serializable** | OCC/system retry can re-evaluate transaction | Yes, several attempts; only one successful commit |

## Scheduled functions

Convex is unusually explicit here. The public `Scheduler` API says:

- a **scheduled mutation is guaranteed to execute exactly once** and is automatically retried on transient errors;
- a **scheduled action executes at most once**, is not retried, and can fail because of a transient error. ([Convex Developer Hub](https://docs.convex.dev/api/interfaces/server.Scheduler?utm_source=chatgpt.com))

Scheduled-function records are stored in the database, and the documentation explicitly says scheduling is resilient to “unexpected downtime or system restarts.” So if a function has been durably scheduled and the Convex backend restarts **before it starts**, the schedule is not supposed to disappear; it remains due and will be processed after the deployment returns. ([Convex Developer Hub](https://docs.convex.dev/scheduling/scheduled-functions?utm_source=chatgpt.com))

There is another useful atomicity boundary: if you call `ctx.scheduler.runAfter/runAt` inside a **mutation**, creating the schedule is part of that mutation's transaction. If the mutation commits, the function is guaranteed to have been scheduled; if the mutation rolls back, the scheduling operation rolls back too. Scheduling from an **action** is not transactional with the action: an action may successfully schedule work and then itself fail, and the already-scheduled work still runs. ([Convex Developer Hub](https://docs.convex.dev/scheduling/scheduled-functions?utm_source=chatgpt.com))

### Can a scheduled mutation “run twice”?

There are two different meanings of “run.”

At the **logical/transactional level**, Convex's published answer is **no: it is exactly-once**. A successful scheduled mutation cannot commit its database effects twice. The current backend source reinforces this implementation: on a successful scheduled mutation, the scheduler changes the job to `Success` in the **same transaction** containing the mutation outcome and then commits that transaction. 

At the **function-evaluation level**, however, the body may be entered/evaluated more than once. Convex explicitly says mutations are deterministic so the system can retry them, and scheduled mutations are automatically retried on transient errors. The ordinary OCC machinery can also rerun a mutation. That means “exactly once” should **not** be read as “the JavaScript handler is entered exactly one time.” It means failed/rolled-back attempts do not create additional committed transactions. ([Convex Developer Hub](https://docs.convex.dev/functions/runtimes?utm_source=chatgpt.com))

This distinction also appears in Convex's Workflow documentation, which describes mutations as exactly-once while expressly excluding rolled-back database-conflict attempts, and says a transaction will neither partially commit nor commit twice. ([GitHub](https://github.com/get-convex/workflow/blob/main/README.md?utm_source=chatgpt.com))

So, for a scheduled mutation:

**zero successful commits** is possible if it reaches a terminal developer error or is canceled; **one successful commit** is the normal exactly-once outcome; **multiple internal evaluations** are possible; **two successful commits for one scheduled job are outside the documented guarantee.**

## Actions

For an ordinary action, Convex explicitly does **not** automatically retry it. The rationale is the classic ambiguous-side-effect problem: if an action sends an invoice, charges a card, or calls some other API and then fails, Convex may not know whether the external operation already happened. Automatically rerunning it could duplicate the side effect. ([Convex Developer Hub](https://docs.convex.dev/functions/actions?utm_source=chatgpt.com))

That gives a clear guarantee about retries, but the public action documentation is **silent about a stronger process-crash protocol for a plain, directly invoked action**. It does not promise that an interrupted action will be resumed, rolled back, or replayed. External side effects are not transactional in the first place.

For a **scheduled action**, the current backend source is considerably more specific than the user docs. A scheduled action has a persisted `InProgress` state. On seeing such a state after a system failure, the scheduler source explicitly handles the case where “backend exits after executing the action but before updating the state”; because actions are at-most-once, it completes the scheduled job as failed with `"Transient error while executing action"` rather than executing it again. 

That is an important crash window:

1. action calls an external service;
2. the external call succeeds;
3. Convex dies before persisting the action's successful completion;
4. after recovery, Convex **does not replay the scheduled action**, because replay could duplicate the side effect;
5. the scheduled-function record can therefore say failure even though the outside world observed the side effect.

That last part is **current implementation/source behavior**, not spelled out in the high-level scheduling documentation. The public guarantee supporting it is only “scheduled actions are at most once.” The source also has an explicit persisted `InProgress` transition for actions. 

A real self-hosted report illustrates why this distinction matters. In backend issue **#487**, a Postgres connection failure during a cron action caused an ambiguous commit and backend shutdown; an in-flight action then raced teardown and the process aborted. It is evidence that “a backend restart gracefully finishes every in-flight action” is not a documented or dependable assumption. ([GitHub](https://github.com/get-convex/convex-backend/issues/487?utm_source=chatgpt.com))

An older self-hosted issue, **#179**, likewise reported a scheduled Node action ending with `"Transient error while executing action"` following a backend failure. ([GitHub](https://github.com/get-convex/convex-backend/issues/179?utm_source=chatgpt.com))

## `@convex-dev/workpool`: retries are deliberately not exactly-once

The current Workpool README says it can retry failed actions with backoff and jitter, specifically for **idempotent actions**. Action retries are configurable using `retry`, `retryActionsByDefault`, and `defaultRetryBehavior`; `retryActionsByDefault` defaults to **false**. Workpool mutations are different: the source documentation says Workpool itself does not externally retry mutations, because Convex already handles database conflicts and transient failures for deterministic mutations. ([GitHub](https://github.com/get-convex/workpool?utm_source=chatgpt.com))

The Workpool documentation is particularly explicit that action retries can cause the action body—and its external effect—to happen more than once. Its idempotency example is essentially:

> the payment succeeds, then the action throws before Convex records completion; a subsequent execution can charge the customer again.

The recommended solution is a stable idempotency/transaction ID understood by the external provider, so the second external request becomes a no-op. ([GitHub](https://github.com/get-convex/workpool?utm_source=chatgpt.com))

Therefore **Workpool retry semantics are not exactly-once execution or exactly-once side effects**. Enabling retries intentionally converts an action from Convex's native at-most-once scheduled-action behavior into a higher-level scheme in which multiple action executions are possible.

### Restart recovery

Current Workpool source explicitly says its recovery path can run because of **“server failures / restarts.”** It checks whether completion has already been recorded, whether the work row is already gone, and whether the stored attempt number has changed; those checks prevent stale recovery/completion events from advancing the same Workpool state twice. It also recognizes underlying scheduled functions that became `failed` or `canceled` and feeds that result into Workpool's completion/retry machinery. ([GitHub](https://github.com/get-convex/workpool/blob/main/src/component/recovery.ts))

Thus, with action retries enabled, an action interrupted by a Convex restart can become a **failed attempt which Workpool subsequently retries**. This is exactly why Workpool's idempotency warning matters: the failed underlying scheduled action may already have caused an external side effect.

### What Workpool does—and does not—deduplicate

There are two distinct kinds of “dedupe”:

**Internal state/attempt dedupe:** yes. Current recovery code checks for an existing pending completion, a deleted/completed work item, and an `attempts` mismatch representing a retry already started. That protects its state machine against stale duplicate completion/recovery processing. ([GitHub](https://github.com/get-convex/workpool/blob/main/src/component/recovery.ts))

**Application-level duplicate enqueue dedupe:** **no documented guarantee.** The current `EnqueueOptions` exposes fields such as `name`, `onComplete`, `context`, `runAt`/`runAfter`, plus retry settings for actions. There is no documented `dedupeKey`/idempotency-key option. `enqueueAction` returns a newly enqueued `WorkId`. In other words, you should not assume two calls to `enqueueAction` with identical function+arguments will collapse into one logical operation. ([GitHub](https://github.com/get-convex/workpool/blob/main/src/client/index.ts?utm_source=chatgpt.com))

Nor does its internal attempt deduplication mean that external side effects are deduplicated. The README explicitly says they are not; that is the application's/external service's job. ([GitHub](https://github.com/get-convex/workpool?utm_source=chatgpt.com))

There is useful historical evidence here too. Workpool **0.4.7** fixed “a race condition where a task could get recovered twice if the scheduler is many minutes behind.” That is a fixed implementation bug, not the current intended semantic, but it demonstrates why internal recovery behavior should not be upgraded into an undocumented exactly-once contract. ([GitHub](https://github.com/get-convex/workpool/blob/main/CHANGELOG.md))

And issue **#198** is a good example of a user assumption being wrong in practice: the user configured an initial Workpool retry backoff of 100 ms, but a regression introduced in 0.4.3 could delay the retry by roughly 60 seconds. Pinning 0.4.2 avoided it; the issue was subsequently closed. In other words, the configured retry policy defines retry intent, but exact wall-clock retry timing was not a hard delivery guarantee. ([GitHub](https://github.com/get-convex/workpool/issues/198?utm_source=chatgpt.com))

## Cron jobs

The public cron documentation gives two important guarantees:

1. a cron's mutation/action execution has the **same error guarantees as scheduled functions**; and
2. **“At most one run of each cron job can be executing at any moment.”** ([Convex Developer Hub](https://docs.convex.dev/scheduling/cron-jobs?utm_source=chatgpt.com))

So two occurrences of the **same cron definition do not overlap**. That does not mean different cron jobs cannot run concurrently.

The docs also explicitly say that if a cron execution takes too long, subsequent scheduled runs **may be skipped** to prevent the job falling behind. ([Convex Developer Hub](https://docs.convex.dev/scheduling/cron-jobs?utm_source=chatgpt.com))

What the public docs **do not specify** is the exact catch-up algorithm following a long deployment pause, outage, or restart. They do not promise “every missed tick will eventually run,” nor do they formally say “all missed ticks are discarded.”

Current backend source fills in that implementation detail. After completing an overdue cron occurrence, it computes successive next timestamps and, while those timestamps are still in the past, increments a skipped-run counter. It logs `SkippingPastScheduledRuns` and records those past occurrences as canceled/skipped. 

So the **observed/current implementation** is effectively:

**one overdue occurrence can execute, but it does not replay an arbitrary backlog of every intervening missed occurrence; additional already-past occurrences are advanced over and logged as skipped.**

That is stronger/more precise than the public documentation, so I would not build an API contract around the exact “one overdue run then skip the rest” algorithm unless Convex documents it.

Also note the interaction with function type: an actually-started cron **mutation** gets mutation/exactly-once transactional semantics; an actually-started cron **action** gets at-most-once action semantics. A cron occurrence that the cron scheduler skips has no function invocation at all.

## Mutation transactions, isolation, and OCC

The public mutation contract has two fundamental properties:

- every database read in a mutation sees a **consistent view**;
- all writes commit together, and if the mutation later throws, none of its writes are committed. ([Convex Developer Hub](https://docs.convex.dev/functions/mutation-functions?utm_source=chatgpt.com))

Convex's OCC documentation then makes an unusually strong isolation claim: its optimistic concurrency control provides **“true serializability,”** explicitly distinguishing that from snapshot isolation. Concurrent successful transactions must therefore be explainable by some serial ordering; snapshot-isolation write-skew anomalies are not part of the promised model. ([Convex Developer Hub](https://docs.convex.dev/database/advanced/occ?utm_source=chatgpt.com))

On conflict, Convex can rerun the deterministic mutation. This is another case where “one mutation call” does **not** imply one execution of the handler body.

Automatic OCC retry is not, however, an infinite guarantee. Convex's error documentation says it performs **several retries**, after which an invocation can throw a write-conflict error if the relevant documents keep changing on every attempt. ([Convex Developer Hub](https://docs.convex.dev/error?utm_source=chatgpt.com))

The current OSS backend has:

`UDF_EXECUTOR_OCC_MAX_RETRIES = 4`

as the default, with an environment-variable override, plus configurable backoff knobs. That is an **implementation default**, not a stable public contract: the public documentation deliberately says only “several retries.” Self-host operators can change it, and Convex Cloud can change implementation tuning without changing the transaction semantics. ([GitHub](https://github.com/get-convex/convex-backend/blob/main/crates/common/src/knobs.rs?utm_source=chatgpt.com))

Issue **get-convex/better-auth #432** is a concrete 2026 example of an assumption failing: a hot rate-limit row experienced enough contention that Convex's internal OCC retries were exhausted, causing real auth requests to fail. So “Convex automatically retries OCC” does **not** mean “an application will never observe an OCC failure.” ([GitHub](https://github.com/get-convex/better-auth/issues/432?utm_source=chatgpt.com))

### The most useful way to state the contracts

For code that needs hard reliability properties, I would reduce the primary-source evidence to this:

- **Scheduled mutation:** durable scheduling + **exactly one committed mutation transaction**, despite potentially multiple rolled-back/internal attempts. ([Convex Developer Hub](https://docs.convex.dev/scheduling/scheduled-functions?utm_source=chatgpt.com))
- **Scheduled action:** durable until it starts, then **at most one execution attempt** by the native scheduler. A crash can leave its external result unknowable; native scheduling will not replay that action. ([Convex Developer Hub](https://docs.convex.dev/api/interfaces/server.Scheduler?utm_source=chatgpt.com))
- **Plain action:** **no automatic retry guarantee**; externally visible effects need application-level idempotency/reconciliation. ([Convex Developer Hub](https://docs.convex.dev/functions/actions?utm_source=chatgpt.com))
- **Workpool action with retry enabled:** **multiple attempts are explicitly possible**. Its bookkeeping tries to deduplicate stale completions/recovery, but it provides no documented exactly-once external-effect guarantee and no enqueue idempotency-key facility. ([GitHub](https://github.com/get-convex/workpool?utm_source=chatgpt.com))
- **Cron:** no overlap for two executions of the **same cron**; missed/late occurrences may be skipped. The precise catch-up-after-outage algorithm is currently an implementation detail. ([Convex Developer Hub](https://docs.convex.dev/scheduling/cron-jobs?utm_source=chatgpt.com))
- **Mutation DB transaction:** atomic and serializable, with automatic OCC retries—but retries are finite, and the function may be evaluated repeatedly before one commit or an eventual conflict error. ([Convex Developer Hub](https://docs.convex.dev/database/advanced/occ?utm_source=chatgpt.com))

The largest documentation silences are therefore **plain-action crash handling**, **the exact cron downtime/catch-up algorithm**, **Workpool application-level enqueue deduplication**, and **the number/timing of automatic OCC retries**. Those should be treated as implementation behavior rather than contractual guarantees unless Convex promotes them into its public docs.

---

If you want, I can:

- Explain how scheduled mutations handle restarts and retries
- Detail Workpool's retry and deduplication mechanisms
- Clarify cron job scheduling behavior and missed run handling
