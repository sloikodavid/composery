# Survey Retry Behavior

Source: https://chatgpt.com/share/6aab2c9c-1e78-83eb-ae38-41dd91ca8dee

---

## Turn 1: User

_2026-09-16T23:52:28.086Z_

As of September 2026, survey how mature provisioning systems decide retry behaviour by the meaning of an error rather than its HTTP status class. Use the Terraform AWS provider's retries-and-waiters design notes, Crossplane's handling of indeterminate creates, Kubernetes controller-runtime's rate-limited workqueue, and Temporal's retry policies. Report concrete code-level patterns for: classifying an error into transient, externally blocked, invalid, indeterminate and bug; choosing a different schedule per class; observing cheaply before repeating an expensive request; and a system-wide retry budget. Include failure stories on both sides: giving up too early and retrying too long.

---

## Turn 2: ChatGPT

_2026-09-16T23:52:27.187Z_

I’ll ground this in the upstream design/docs and code paths for all four systems, then synthesize the recurring pattern into an error-semantics retry model with concrete pseudocode and failure modes.

---

## Turn 3: ChatGPT

_2026-09-16T23:53:00.118Z_

The sources already show a key distinction: mature systems separate “retry this failed request” from “poll for state.” Terraform uses explicit waiters for the latter; controller-runtime now explicitly says `RequeueAfter` is for waiting on external events, while error retries use the rate limiter.

---

## Turn 4: ChatGPT

_2026-09-16T23:53:32.362Z_

Crossplane supplies the strongest “don’t blindly retry” example: after a create whose outcome cannot be proven, it deliberately halts rather than risk a duplicate/leak. Its current docs call this the safest behavior when external names are nondeterministic.

---

## Turn 5: ChatGPT

_2026-09-16T23:54:13.083Z_

As of **17 September 2026**, the strongest common pattern across Terraform AWS, Crossplane, Kubernetes controllers, and Temporal is this:

> **HTTP status is evidence, not policy.** First decide what the failure *means for the operation you were performing*; then decide whether to retry, wait, observe, stop, or escalate.

A `404`, `403`, `409`, timeout, or even a nominally successful response can mean different things depending on whether the controller is creating, observing, waiting for propagation, or recovering from a lost acknowledgement. Terraform AWS makes this explicit with API-code/message predicates and lifecycle waiters; Crossplane goes further by representing an ambiguous create as a distinct safety state; controller-runtime separates error backoff from deliberate polling; Temporal makes application error type and retryability part of the durable failure record. ([GitHub](https://github.com/hashicorp/terraform-provider-aws/blob/main/docs/retries-and-waiters.md))

## A useful five-way classification

| Class | Meaning | Typical evidence | Correct behaviour |
|---|---|---|---|
| **Transient** | Repeating the same operation is safe and the condition is expected to clear by itself. | throttling; temporary transport failure known to precede sending; AWS “operation already in progress”; read-after-write `NotFound`. | Exponential backoff + jitter, short cap, bounded elapsed time. Honor server retry hints. |
| **Externally blocked** | The request is legitimate, but some other state must change first. | propagation, dependency not ready, quota release, approval, credentials being rotated. | Poll slowly or wake on an event. Do **not** treat every observation as another failure. |
| **Invalid** | Repeating the same desired state cannot succeed. | validation failure, unsupported parameter, immutable-field violation, permanently bad identity. | Terminal until input/config changes; make the reason visible. |
| **Indeterminate** | A mutation may have committed but the caller did not learn the result. | timeout/EOF after sending `Create`; worker dies between cloud create and persisting external ID. | **Do not repeat the mutation first. Observe/recover identity first.** Quarantine if existence cannot safely be proved. |
| **Bug** | Local invariants or program logic have failed rather than the remote dependency. | panic, impossible enum/state, nil success object, Temporal nondeterminism. | Alert and bound automatic replay; avoid turning a deterministic software defect into a retry storm. |

The HTTP mapping therefore cannot simply be `4xx = permanent; 5xx = retryable`. Terraform's AWS notes, for example, call out IAM-related errors in which a newly created role may temporarily appear nonexistent or insufficiently privileged, and recommend narrowly bounded operation-specific retries. The same provider explicitly retries an S3 `OperationAborted` conflict by matching both AWS error type and message. ([GitHub](https://github.com/hashicorp/terraform-provider-aws/blob/main/docs/retries-and-waiters.md))

A practical interpretation is that **phase is part of the error type**. A `404` immediately after `Create` can mean “AWS hasn't made it visible yet”; the same `404` during steady-state refresh can mean “the resource was deleted.” A `409 AlreadyExists` after a create whose response was lost is evidence of an **indeterminate successful create**, whereas another `409` may merely mean a short-lived concurrent operation. A `403` immediately after IAM changes may be propagation; a stable `403` from unchanged credentials is configuration/operator work, not something exponential retries will repair. Terraform's lifecycle code explicitly retries “not found” only for new resources and otherwise removes a missing resource from state. ([GitHub](https://github.com/hashicorp/terraform-provider-aws/blob/main/docs/retries-and-waiters.md))

## What the four systems contribute

**Terraform AWS: distinguish retrying a request from waiting for state.** The provider uses `tfresource.Retry()` for errors judged retryable by AWS code/message/type and `NonRetryableError` for everything else. Its contributor guidance says these eventual-consistency retries should usually be only about two minutes, at most roughly five. IAM has a standard two-minute propagation allowance derived from operational experience. For asynchronous work, the provider separately uses `retry.StateChangeConf` with explicit `Pending` and `Target` states, polling `Get`/`Describe` rather than reissuing `Create`. ([GitHub](https://github.com/hashicorp/terraform-provider-aws/blob/main/docs/retries-and-waiters.md))

That distinction matters. After creating a resource, Terraform's recommended implementation does a cheap `Get`/`Describe`; a temporary `ResourceNotFoundException` becomes a polling condition. For asynchronous creation, `ThingStatus()` can return `CREATING`, then the waiter observes until `CREATED`. This is exactly “observe cheaply before repeating an expensive request.” ([GitHub](https://github.com/hashicorp/terraform-provider-aws/blob/main/docs/retries-and-waiters.md))

Terraform also demonstrates why **generic transport retries need a much smaller safety envelope**. The AWS provider historically defaults the SDK retry count to 25, approximately an hour of exponential retrying in some cases, but lowers certain poorly recoverable network errors to ten retries, roughly 30 seconds. A historical issue describes a bad corporate DNS resolver causing a request to sit in retries for an extremely long time and thereby delaying diagnosis of the actual problem. ([GitHub](https://github.com/hashicorp/terraform-provider-aws/blob/main/docs/retries-and-waiters.md))

**Crossplane: make “I don't know whether Create happened” first-class state.** Its provider interface is explicitly Observe→Create/Update/Delete: `Create` is invoked only after `Observe` reports that the external resource is absent, and the API asks implementations to make lifecycle operations idempotent. `ExternalObservation.ResourceExists` and `ResourceUpToDate` encode what was discovered rather than simply replaying the previous command. ([Go Packages](https://pkg.go.dev/github.com/crossplane/crossplane-runtime/pkg/reconciler/managed))

Crossplane's creation annotations are the most explicit treatment of indeterminacy in these systems. Before create it records `crossplane.io/external-create-pending`; after a definitely successful or definitely failed create it records a corresponding timestamp. If `pending` is newer than both, the controller concludes that an external object **might have been created without its identity being persisted**. It then stops reconciliation and emits `cannot determine creation result`, because blindly creating again could leak a second VPC, database, queue, etc. Current Crossplane documentation explicitly describes stopping for human intervention as the safest course when identity cannot be reconstructed. ([docs.crossplane.io](https://docs.crossplane.io/v2.3/managed-resources/managed-resources/?utm_source=chatgpt.com))

This isn't theoretical. A Crossplane provider-Terraform issue describes killing the provider pod while `terraform apply` was running: the external operation was interrupted while the attempt to record the failure annotation also lost its context, leaving `external-create-pending` and a resource that would no longer proceed automatically. That's the operational cost of choosing “possibly stuck” over “possibly duplicate expensive infrastructure.” ([GitHub](https://github.com/crossplane/crossplane-runtime/issues/340?utm_source=chatgpt.com)) Crossplane now even has a `RetryingCriticalAnnotationUpdater`, specifically retrying persistence of this critical bookkeeping state against API-server errors. ([Go Packages](https://pkg.go.dev/github.com/crossplane/crossplane-runtime/pkg/reconciler/managed))

**controller-runtime: use the queue for retry scheduling, but don't confuse failure with waiting.** A non-terminal error returned by `Reconcile` causes rate-limited exponential requeue; `TerminalError` does not requeue. By contrast, `Result{RequeueAfter: d}` schedules a deliberate future reconciliation without treating the situation as an error. The current API actually deprecates bare `Requeue: true`, saying that external events should use a known duration or polling interval rather than an error rate limiter. ([GitHub](https://github.com/kubernetes-sigs/controller-runtime/blob/main/pkg/reconcile/reconcile.go?utm_source=chatgpt.com))

The underlying `client-go` rate-limiter design historically combined a per-item exponential limiter—5 ms up to 1,000 seconds—with an overall token bucket of 10 requeues/s and burst 100. Current controller-runtime has the priority queue enabled by default and, in that configuration, defaults to the per-item 5 ms→1,000 s limiter; a custom `RateLimiter` remains configurable. ([GitHub](https://github.com/kubernetes/client-go/blob/master/util/workqueue/default_rate_limiters.go?utm_source=chatgpt.com))

Crossplane found those generic timings poor for cloud resources: 5 ms is often far too soon to retry a provider API, while ~16 minutes can become far too long to recover after the condition clears. It therefore supplies a more cloud-oriented per-object 1 s→60 s backoff and a separate **global** token bucket; `NewGlobal(rps)` is shareable by multiple reconcilers and allows a burst of `10 × rps`. ([GitHub](https://github.com/kubernetes-sigs/controller-runtime/issues/631?utm_source=chatgpt.com)) This is an important architectural lesson: **per-object fairness and provider-wide pressure control are separate mechanisms**.

**Temporal: encode retry semantics in the error, not in HTTP.** Activities retry by default with a 1-second initial interval, coefficient 2, maximum interval 100 seconds, and no default maximum-attempt count. Application Failures carry a `type` and a `non_retryable` flag; a Retry Policy can also name non-retryable error types. An individual failure can supply `NextRetryDelay`, overriding the generic exponential interval while still respecting the overall attempt and timeout bounds. ([GitHub](https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/retry-policies.mdx?utm_source=chatgpt.com))

That gives you a direct representation of semantic classes:

```go
return temporal.NewNonRetryableApplicationError(
    "region is not supported",
    "InvalidConfiguration",
    nil,
)

return temporal.NewApplicationErrorWithOptions(
    "partner quota exhausted until reset",
    "ExternallyBlocked",
    temporal.ApplicationErrorOptions{
        NextRetryDelay: 10 * time.Minute,
    },
)
```

There is an instructive implementation trap here: Temporal's service examines the **outermost** serialized failure for retryability. If code catches a non-retryable `ApplicationFailure` and wraps it in a generic language error, the SDK may serialize the outer error as an ordinary retryable Application Failure, silently throwing away the intended non-retryable semantics. That's a particularly clean example of why retry classification must survive error wrapping. ([GitHub](https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/application-failures.mdx?utm_source=chatgpt.com))

## A code-level provisioning pattern

The pattern I would extract from these four systems is something like:

```go
type FailureClass int

const (
    Transient FailureClass = iota
    ExternallyBlocked
    Invalid
    Indeterminate
    Bug
)

type RetryDecision struct {
    Class        FailureClass
    SafeToMutate bool
    ObserveFirst bool
    Next         time.Duration
    MaxElapsed   time.Duration
    BudgetCost   int
}

func classify(op Operation, phase Phase, err error) RetryDecision {
    // Provider/application semantics beat HTTP status.
    switch {
    case isValidation(err), isUnsupported(err):
        return RetryDecision{Class: Invalid}

    case isCreateAlreadyExists(err) && phase.CreateOutcomeUnknown:
        return RetryDecision{
            Class: Indeterminate, ObserveFirst: true,
        }

    case isNotFound(err) && phase.JustCreated:
        return RetryDecision{
            Class: ExternallyBlocked,
            ObserveFirst: true,
            Next: 5 * time.Second,
        }

    case isOperationInProgress(err), isThrottle(err):
        return RetryDecision{
            Class: Transient,
            SafeToMutate: true,
            Next: jitteredBackoff(),
            MaxElapsed: 2 * time.Minute,
            BudgetCost: 1,
        }

    case requestMayHaveReachedServer(err) && op.IsNonIdempotentWrite():
        return RetryDecision{
            Class: Indeterminate, ObserveFirst: true,
        }

    case isPanic(err), violatesLocalInvariant(err):
        return RetryDecision{Class: Bug}

    default:
        return boundedUnknownPolicy(op)
    }
}
```

The important bit is not these exact durations. It is that **classification returns a control-plane action**, not merely `retry=true/false`.

For an indeterminate `Create`, the follow-up should resemble Crossplane or a Terraform waiter:

```go
obs, err := ObserveByIdempotencyKey(ctx, desired.Key)

switch {
case err == nil && obs.Exists:
    adopt(obs.ID)                     // create had succeeded
case err == nil && obs.ProvenAbsent:
    retryCreateOnlyIfIdempotent()     // safe negative proof
case observationWindowExpired():
    quarantineForOperator()           // ambiguity remains
default:
    scheduleCheapObserve()
}
```

That is much safer than wrapping `Create()` itself in a generic exponential-retry loop. Crossplane's Observe/Create contract and creation annotations, and Terraform's post-create `Get`/`Describe` plus state waiters, are essentially production implementations of this idea. ([Go Packages](https://pkg.go.dev/github.com/crossplane/crossplane-runtime/pkg/reconciler/managed))

## Different schedules for different meanings

A mature implementation therefore has **multiple clocks**. Transient failures get jittered exponential backoff because fast recovery is plausible and repeated pressure is harmful. Externally blocked states generally get a slower fixed/adaptive poll—say 30 seconds, two minutes, or the provider's explicit `Retry-After`—and should preferably be awakened by the dependency changing. Invalid states get no timer at all; a configuration generation/change event reactivates them. Indeterminate writes get a comparatively quick **observation** schedule, but no second write until safety is established. Bugs should normally trip an alert/circuit breaker rather than exponentially replay identical broken code.

Controller-runtime embodies the first three mechanically: error → rate-limited queue, `RequeueAfter` → intentional poll, `TerminalError` → no retry. Temporal's `NextRetryDelay`, non-retryable errors and total Activity timeout provide an analogous workflow-level vocabulary. ([GitHub](https://github.com/kubernetes-sigs/controller-runtime/blob/main/pkg/reconcile/reconcile.go?utm_source=chatgpt.com))

## System-wide retry budget

Per-object backoff is insufficient in a provisioning fleet. If 50,000 resources all hit the same AWS outage, every one can be behaving “responsibly” while the aggregate becomes a retry storm.

The systems here already contain pieces of the right solution. Crossplane offers a token bucket shared across multiple reconcilers. AWS SDK v2 uses a retry token bucket shared across all requests for an API client; the Terraform AWS maintainers have seen this budget actually exhaust, yielding errors such as `retry quota exceeded`. Temporal can impose a server-controlled Activities-per-second limit across all workers on a Task Queue. ([Go Packages](https://pkg.go.dev/github.com/crossplane/crossplane-runtime/pkg/ratelimiter?utm_source=chatgpt.com))

For a provisioning system I would make that explicit as a **hierarchical budget**:

```text
per-resource budget
    maximum attempts + maximum elapsed time

        ↓

per-dependency budget
    e.g. AWS EC2/us-east-1, GitHub API, vSphere cluster
    shared token bucket / adaptive concurrency

        ↓

system retry budget
    maximum aggregate retry work per second
    with a reserved pool for cheap Observe/Get operations
```

The reserved observation capacity is important. If mutation retries consume every token, the controller can become unable to perform the cheap reads that would tell it **not** to retry mutations.

I'd also make mutation costs weighted: `Describe=1`, idempotent update perhaps `5`, non-idempotent create `20`, with indeterminate retries forbidden regardless of available tokens. This is a synthesis rather than something any one of the four frameworks ships wholesale, but it follows directly from Crossplane's shared global limiter, AWS's shared retry quota, and Temporal's task-queue-wide rate limiting. ([Go Packages](https://pkg.go.dev/github.com/crossplane/crossplane-runtime/pkg/ratelimiter?utm_source=chatgpt.com))

A further refinement is to replenish retry budget partly in proportion to successful primary traffic rather than offering a fixed unlimited retry stream. That prevents recovery traffic from overwhelming a dependency precisely when its successful capacity has collapsed.

## Failure stories: both mistakes hurt

1. **Giving up too early — Temporal's documented “one attempt” trap.** Temporal warns that `MaximumAttempts=1` means a Worker can call an external API successfully, crash before recording completion, and leave a permanent gap because no second Activity attempt is allowed. The fix isn't simply “retry everything”; it is idempotency keys plus enough retry allowance to recover ambiguous worker failures. ([GitHub](https://github.com/temporalio/documentation/blob/main/docs/design-patterns/fixed-count-retries.mdx))

2. **Giving up safely but painfully — Crossplane indeterminate creation.** Killing provider-Terraform during a long `terraform apply` produced a stuck `external-create-pending` state requiring human intervention. That can look like premature failure operationally, but retrying the create automatically could duplicate infrastructure. Crossplane intentionally prefers intervention where proof is unavailable. ([GitHub](https://github.com/crossplane/crossplane-runtime/issues/340?utm_source=chatgpt.com))

3. **A hard attempt cap can silently abandon recoverable work.** The `client-go` workqueue example demonstrates five retries and then `Forget()`/drop, with the error reported externally. That is appropriate only if some other mechanism—watch event, periodic resync, alert/operator—can bring the item back. Otherwise a dependency that recovers after attempt six never gets reconciled. ([GitHub](https://github.com/kubernetes/client-go/blob/master/examples/workqueue/main.go?utm_source=chatgpt.com))

4. **Retrying too long — Terraform and broken DNS.** The AWS provider's historic 25-retry default let a non-remediable DNS problem keep Terraform occupied for tens of minutes to over an hour, hiding the real failure until the retry sequence completed. The contributor guide now explicitly calls the resulting wait excessive and gives certain network failures a much smaller retry allowance. ([GitHub](https://github.com/hashicorp/terraform-provider-aws/issues/1209?utm_source=chatgpt.com))

5. **Retrying too long — unlimited retries become a cost bug.** Temporal's default Activity policy has unlimited attempts. Its own 2026 design-pattern guidance warns that a paid API, generative-AI request, or scarce partner quota can therefore accumulate very large unintended cost; it recommends `MaximumAttempts` where each execution consumes money or scarce capacity. ([GitHub](https://github.com/temporalio/documentation/blob/main/docs/design-patterns/fixed-count-retries.mdx))

6. **Losing semantics can cause endless retries.** Temporal specifically documents that generically wrapping a non-retryable Application Failure can lose the flag and make the operation retryable again. The error message is still “the same,” but the machine-readable meaning has been destroyed. ([GitHub](https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/application-failures.mdx?utm_source=chatgpt.com))

7. **Backoff itself can contain bugs.** An open Temporal issue filed **10 September 2026** reports an internal Go exponential-retry path producing an approximately **292-year** delay on arm64 after overflow when its maximum interval was disabled. Normal Temporal Activity defaults do have a 100-second maximum interval, but the case is a memorable reason to cap delay arithmetic as well as attempt counts. ([GitHub](https://github.com/temporalio/temporal/issues/11991?utm_source=chatgpt.com))

The resulting design principle is: **retry is a state-machine transition, not an HTTP middleware feature**. Keep low-level transport retrying small and conservative. Lift provider-specific codes into semantic classes. Separate mutation from observation. Persist enough intent before non-idempotent writes to recognize ambiguous outcomes. Give each class a distinct clock. Finally, place all those local policies under a shared retry budget so that individually reasonable controllers remain reasonable when thousands fail at once.

---

If you want, I can:

- Explain how Terraform AWS implements retry-after-create using waiters
- Describe Crossplane's approach to indeterminate creates and how it handles creation ambiguity
- Summarize system-wide retry budgets and hierarchical limits in provisioning systems
