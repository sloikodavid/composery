# Retry Policy Survey

Source: https://chatgpt.com/share/6aab1668-d90c-83eb-8a9f-b34dcc461ba0

---

## Turn 1: User

_2026-09-16T22:14:37.963Z_

A control plane reconciles cloud resources through an API that has no webhooks, so it polls. When an operation fails it retries with exponential backoff, and after a number of failures it marks the resource as blocked and slows to hourly retries that continue indefinitely. Survey how mature systems actually decide this: Kubernetes controllers and their rate-limited workqueues, Terraform, Crossplane, AWS Step Functions, Temporal, and any provisioning systems with published design notes. For each, explain what distinguishes a condition worth retrying from one that is not, whether they ever stop permanently and what happens then, how they avoid hot-looping on a permanent condition, how they make a stuck resource visible to an operator, and how they keep retries safe against acting twice. Report where practitioners disagree, and include documented incidents caused both by giving up too early and by retrying too long.

---

## Turn 2: ChatGPT

_2026-09-16T22:14:37.205Z_

I’ll compare the retry models side by side, then trace failure-handling details into design docs and incident reports. I’ll separate documented behavior from practitioner convention, because “retryable” is often an API-contract decision rather than a property of the error code alone.

---

## Turn 3: ChatGPT

_2026-09-16T22:14:52.144Z_

A useful pattern is already emerging: queue frameworks usually provide backoff mechanics, but the controller/application decides when to “forget,” when to classify an error as terminal, and what operator-visible state to persist. That distinction matters because some systems deliberately retry forever at a capped cadence, while workflow engines more often make exhaustion a first-class terminal state.

---

## Turn 4: ChatGPT

_2026-09-16T22:17:11.153Z_

The main split is not “controllers retry forever, workflows stop.” It is **whether the system models an object that must remain convergent over an indefinite lifetime, or an execution with a bounded lifetime**. Kubernetes/Crossplane-style reconcilers generally preserve the right to try again later; Terraform, Step Functions, and many Temporal workflows have a clearer notion of an execution ending.

A second, stronger pattern is that **attempt count is rarely treated as evidence that an error has become non-retryable**. Mature systems classify the *kind of failure* separately from the *retry schedule*. That has an important implication for your “blocked after N failures, then hourly forever” design: it is a reasonable degradation mode for some externally remediable failures, but it should not be the universal outcome after N attempts.

### How the systems differ

| System | What is considered retryable? | Does it stop? | Avoiding a hot loop | Operator visibility | Protection against duplicate effects |
|---|---|---|---|---|---|
| **Kubernetes client-go / controller-runtime** | The workqueue itself does **not** decide semantics. Ordinary returned errors are retried; controller code can classify an error as terminal or return success and arrange a later poll. | `TerminalError` causes no automatic requeue. Otherwise retries can continue indefinitely; a later watched event can wake the object again. | Default client-go limiter combines per-item exponential backoff, **5 ms → 1000 s**, with a controller-wide **10 QPS / burst 100** bucket. Max failures/expiration are explicitly “up to the caller.” ([GitHub](https://github.com/kubernetes/client-go/blob/master/util/workqueue/default_rate_limiters.go?utm_source=chatgpt.com)) | Resource `status.conditions`, Events, controller metrics/logs. Deployment, for example, sets `Progressing=False/ProgressDeadlineExceeded`; Kubernetes reports it but deliberately does not roll back automatically, and the controller keeps retrying. ([Kubernetes](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/?utm_source=chatgpt.com)) | Reconcilers are level-based: reread reality and drive it toward desired state rather than replaying an event. External mutations still need idempotent APIs, stable names/tokens, or explicit duplicate detection. ([Go Packages](https://pkg.go.dev/sigs.k8s.io/controller-runtime/pkg/reconcile?utm_source=chatgpt.com)) |
| **Terraform** | Primarily decided inside each provider. SDK APIs explicitly distinguish `RetryableError` from `NonRetryableError`; waiters distinguish pending/target/error states. Eventual consistency is normally retryable. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/sdkv2/resources/retries-and-customizable-timeouts?utm_source=chatgpt.com)) | Yes. Provider retries are bounded by operation timeouts. If an apply still fails, Terraform records what state it has, exits, and waits for the operator/automation to run another apply; it does not continually reconcile in the background. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/cli/commands/apply?utm_source=chatgpt.com)) | Provider retry intervals, waiters and timeouts rather than infinite tight loops. | Error diagnostics go directly to the practitioner. State updates made before the failure can still be persisted; failed creates can be marked for recreation. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/framework/diagnostics?utm_source=chatgpt.com)) | Persist remote IDs/state, reread after create, detect pre-existing objects rather than silently adopting them, and recreate tainted partial objects. Exact safety ultimately depends on the provider/API. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/framework/resources/create?utm_source=chatgpt.com)) |
| **Crossplane** | Similar to Kubernetes, but provider code has considerable domain knowledge. Most provider errors are recoverable/retried; some errors or states need explicit operator intervention. | Usually keeps reconciling. A major exception is an **indeterminate create**: Crossplane intentionally stops when it cannot tell whether a create succeeded, until a human establishes that retrying is safe. ([Crossplane Documentation](https://docs.crossplane.io/v2.3/managed-resources/managed-resources/?utm_source=chatgpt.com)) | Crossplane providers historically moved to saner cloud-oriented limits—commonly per-object exponential backoff around **1–60 s** plus a global limiter—rather than controller-runtime’s 5 ms start. ([GitHub](https://github.com/crossplane/crossplane/issues/2595?utm_source=chatgpt.com)) | `Ready`/`Synced` conditions plus Kubernetes Events. The create-leak guard produces a very explicit “cannot determine creation result” warning telling the operator what to inspect. ([GitHub](https://github.com/crossplane/crossplane/issues/3037?utm_source=chatgpt.com)) | Particularly strong: `external-create-pending`, `...-succeeded`, and `...-failed` timestamps plus the external name let it detect the dangerous crash window between creating a cloud object and recording its identity. When uncertain, **it prefers stopping over risking a second resource**. ([Crossplane Documentation](https://docs.crossplane.io/v2.3/managed-resources/managed-resources/?utm_source=chatgpt.com)) |
| **AWS Step Functions** | Retry is an explicit part of the workflow definition: named errors are matched by `ErrorEquals`. You can explicitly exclude classes such as timeouts; `States.Runtime` is intrinsically non-retryable. ([AWS Documentation](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)) | Definitely. `MaxAttempts` defaults to 3; after exhaustion the state goes through `Catch`, if present, otherwise the execution fails. Here `MaxAttempts: 0` means **never retry**. ([AWS Documentation](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html?utm_source=chatgpt.com)) | Exponential `BackoffRate`, `MaxDelaySeconds`, and optional full jitter, all inside a bounded attempt budget. ([AWS Documentation](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html?utm_source=chatgpt.com)) | Failed execution, failed state, error/cause, retry attempts and execution history are first-class console/API state. Failed Standard executions can be redriven from the failed point; completed earlier states are not rerun. ([AWS Documentation](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html?utm_source=chatgpt.com)) | Step Functions cannot make an arbitrary side-effecting task exactly once. AWS recommends idempotent service APIs with a caller-provided request token reused across retries; duplicate tokens yield a semantically equivalent outcome. ([Amazon Web Services, Inc.](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/?utm_source=chatgpt.com)) |
| **Temporal** | Activities are presumed to encounter transient failures, so they retry by default. The application can mark particular failures non-retryable; Temporal explicitly distinguishes transient/intermittent failures from permanent failures requiring changed logic or input. ([Temporal Docs](https://docs.temporal.io/encyclopedia/retry-policies)) | Interesting opposite default to Step Functions: Activity `Maximum Attempts = 0` means **unlimited**, not zero. Defaults are 1 s initial, coefficient 2, 100 s max interval, unlimited attempts. You normally stop via a non-retryable failure or an overall timeout. Whole Workflow Executions do **not** retry by default. ([Temporal Docs](https://docs.temporal.io/encyclopedia/retry-policies)) | Exponential backoff capped by maximum interval, plus Schedule-to-Close / Workflow Execution time budgets. Temporal advises using non-retryable errors sparingly. ([Temporal Docs](https://docs.temporal.io/encyclopedia/retry-policies)) | Workflow status/history plus pending Activity information; the Describe API exposes attempt count while an Activity is still retrying. ([Temporal Docs](https://docs.temporal.io/encyclopedia/retry-policies)) | Temporal explicitly requires Activities to be designed as idempotent because an Activity may have performed its external side effect and then failed to report completion. Their documentation uses cloud provisioning creating duplicate servers as an example. ([Temporal Docs](https://docs.temporal.io/activity-definition)) |
| **Cluster API, as an instructive Kubernetes provisioning design** | Moving away from globally declaring errors “terminal.” A provider exposes a condition/reason describing what it sees; consumers decide its significance. | Usually preserves reconciliation semantics rather than turning the object into a permanently dead execution. | Same controller mechanisms as Kubernetes; providers control scheduling. | Conditions are deliberately designed as the operator-facing API. | Provider-specific external-resource identity plus Kubernetes reconciliation patterns. |

Cluster API is especially revealing. Its newer status design explicitly says the Kubernetes resource model does not have a natural concept corresponding to its old “terminal failure” fields; it is removing `FailureReason`/`FailureMessage` in favor of conditions with well-defined reasons, leaving consumers to decide what to do with them. ([GitHub](https://github.com/kubernetes-sigs/cluster-api/blob/main/docs/proposals/20240916-improve-status-in-CAPI-resources.md?utm_source=chatgpt.com)) That is a fairly strong vote against making “permanent failure” a universal resource lifecycle state in a long-lived control plane.

## What “retryable” means in practice

Across these systems, four classes recur.

**Transient transport/service failures** are the easy class: connection failures, throttling, many 5xx responses, temporary unavailability, lock contention, and “operation still in progress.” They get exponential backoff, preferably jitter, with a cap. Terraform’s AWS provider documents retrying network/server/throttling conditions and has operation-specific retries for known eventual-consistency behavior. ([GitHub](https://github.com/hashicorp/terraform-provider-aws/blob/main/docs/retries-and-waiters.md?utm_source=chatgpt.com))

**Deterministic bad requests** are the clearest non-retryable class: malformed configuration, an invalid parameter combination, or an invariant/programming failure. Temporal uses bad input as its canonical non-retryable example; Step Functions makes `States.Runtime` an always-failing execution error. ([Temporal Docs](https://docs.temporal.io/encyclopedia/retry-policies)) An hourly retry of a syntactically impossible request normally buys nothing.

**Externally remediable conditions** are where controller systems diverge from workflow engines. A 403, exhausted quota, missing prerequisite, missing secret, or dependency that does not yet exist may remain unchanged for three days and then be fixed by someone outside your controller. A workflow engine is comfortable failing the execution and making a human redrive/restart it. A long-lived reconciler often wants to remain alive, surface `Blocked/Degraded`, and retry when either an input changes or a low-frequency poll says reality may have changed. Kubernetes’ quota example illustrates this: the Deployment may report failure to progress, but fixing quota later allows reconciliation to proceed. ([Kubernetes](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/?utm_source=chatgpt.com))

**Indeterminate side-effect failures** deserve their own state entirely. A timeout on `CreateVM` does not mean “the VM was not created.” Blindly issuing `CreateVM` again can be much worse than either stopping or retrying. Crossplane’s external-create-pending mechanism is the clearest published design I found: if it cannot establish whether the first create happened, it stops automated creation and asks a human to inspect the provider before clearing the gate. ([Crossplane Documentation](https://docs.crossplane.io/v2.3/managed-resources/managed-resources/?utm_source=chatgpt.com)) AWS attacks the same problem lower in the stack by making creates idempotent using a stable client request token. ([Amazon Web Services, Inc.](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/?utm_source=chatgpt.com))

That fourth class is the biggest omission in a simple `{retryable, permanent}` model.

## Where practitioners disagree

There is genuine disagreement about **whether a controller should ever call an externally correctable error terminal**. Workflow-oriented systems say yes: finite retry budgets turn silent stalls into explicit failures, and a human or parent workflow can choose recovery. Step Functions embodies this strongly. Terraform similarly gives the provider a bounded attempt window and then returns control to the practitioner.

Kubernetes-oriented practitioners are more reluctant. A resource represents desired state indefinitely; “permission denied for 20 minutes” does not imply “permission denied forever.” Cluster API’s move away from terminal-failure fields reflects that philosophy. Crossplane’s early retry discussions likewise assumed errors should generally be retried unless *known* to be unrecoverable. ([GitHub](https://github.com/crossplane/crossplane-runtime/issues/40?utm_source=chatgpt.com))

There is also disagreement about **the right backoff range**. controller-runtime inherited a general-purpose default beginning at 5 ms and reaching roughly 16⅔ minutes. Crossplane maintainers explicitly complained that both ends were wrong for cloud APIs: 5 ms can be absurdly fast, while a 16-minute invisible wait makes reconciliation appear mysteriously stuck. They also pointed out that ordinary users often cannot see the workqueue’s backoff state. ([GitHub](https://github.com/kubernetes-sigs/controller-runtime/issues/631?utm_source=chatgpt.com)) Crossplane moved toward roughly 1–60-second per-object backoff with global limiting. ([GitHub](https://github.com/crossplane/crossplane/issues/2595?utm_source=chatgpt.com))

Finally, practitioners disagree over **attempt limit versus elapsed-time budget**. Step Functions exposes attempts prominently. Temporal supports attempts but recommends overall execution/Schedule-to-Close timeouts in many cases instead, because “five attempts” has wildly different meaning for a 50-ms network operation versus a 30-minute provisioning call. ([Temporal Docs](https://docs.temporal.io/encyclopedia/retry-policies)) Terraform similarly organizes retrying around operation timeouts.

## Failures from retrying too long

There are some unusually clean real-world examples.

Crossplane/Upjet had a reported failure in which errors from the Observe path bypassed the intended rate limiter and requeued with **0 seconds delay**. AWS throttling errors were retried every 1–3 seconds indefinitely. With more than 100 RDS resources, the retries made the throttling progressively worse until other resources were throttled too—the classic positive-feedback retry storm. ([GitHub](https://github.com/crossplane/upjet/issues/592?utm_source=chatgpt.com))

A Terraform AWS provider issue from 2017 shows the subtler version. Its then-default 25 AWS SDK retries caused a permanent local DNS failure to look like a resource “hanging” for more than an hour in some cases; the reporter calculated roughly 26 minutes of sleep alone, before request timeout time, and complained that the actual retry reason was not visible while waiting. ([GitHub](https://github.com/hashicorp/terraform-provider-aws/issues/1209?utm_source=chatgpt.com)) The disagreement is instructive: the retry policy was excellent for AWS transient faults but terrible for a deterministic local resolver failure.

And in January 2026 Redocly documented an outage where a failed RabbitMQ cleanup job entered an **infinite redelivery loop every 20 seconds with no backoff**. The loop hammered a large database until the API OOMed; repeated restarts then accumulated roughly 1,900 dynamic database roles and exhausted the secrets system. The incident lasted about 3.5 hours, with roughly an hour of customer-facing impact. Their remediation explicitly included backoff, retry limits, throttling, and the ability to halt processing. ([Redocly](https://redocly.com/blog/jan-2026-outage-postmortem?utm_source=chatgpt.com))

Those cases argue for *both* a per-resource backoff and a system-wide retry budget/token bucket. Per-item exponential backoff alone does not protect you when 50,000 resources simultaneously fail for the same reason.

## Failures from giving up too early

Terraform’s AWS provider is a rich source because cloud eventual consistency repeatedly looks like a permanent 4xx.

A concrete 2024 CodeBuild regression had Terraform create an IAM role and then immediately attempt to create a CodeBuild project. CodeBuild returned HTTP 400 `InvalidInputException: Not authorized to perform DescribeSecurityGroups`; the provider treated the operation as failed even though the newly-created IAM permissions had simply not propagated yet. ([GitHub](https://github.com/hashicorp/terraform-provider-aws/issues/37049?utm_source=chatgpt.com))

This is common enough that the AWS provider now has an explicit design note for **IAM eventual-consistency errors**, including a standard two-minute propagation retry window derived, it says, from years of operational experience. The design guidance is not “retry every 400”; it says each AWS operation needs specific recognition of the error code/message that represents propagation and all other errors should remain non-retryable. ([GitHub](https://github.com/hashicorp/terraform-provider-aws/blob/main/docs/retries-and-waiters.md?utm_source=chatgpt.com)) Current provider releases still contain fixes adding retry treatment for newly discovered IAM propagation cases, which illustrates that this classification is empirical and evolves over time. ([GitHub](https://github.com/hashicorp/terraform-provider-aws/releases?utm_source=chatgpt.com))

That is why raw HTTP class is a poor classifier. “400” can mean invalid forever, or “the distributed control plane has not converged yet.”

## What this suggests for your control plane

Your current **“normal exponential retries → blocked → hourly forever”** design is close to a good controller pattern, but I would change the state machine. The key is to make **failure semantics drive scheduling**, rather than letting failure count turn one semantic category into another.

I would model at least these outcomes:

| Outcome | Examples | Scheduling |
|---|---|---|
| `Transient` | timeout before request, 429, 5xx, service unavailable, operation still progressing, known eventual consistency | Exponential backoff + jitter, capped; reset on success |
| `BlockedExternal` | permission missing, quota, prerequisite absent, account suspended, credential needing operator change | Mark resource visibly blocked; **slow probe** such as 15–60 min with jitter, plus immediate wake on relevant spec/credential/config change |
| `InvalidSpec` | malformed/unsupported combination, deterministic validation failure | No periodic mutation retry; retry immediately only when the resource generation/config changes |
| `IndeterminateMutation` | create/update may have committed but response was lost | **Do not repeat the mutation** unless it carries a stable idempotency token; observe by stable identity first, otherwise require operator resolution |
| `Bug/InvariantFailure` | impossible controller state, serialization/programming error | Stop this reconcile path, surface loudly, alert; let deployment/restart/spec change cause a future attempt rather than pounding the API |

The important change is that **N consecutive failures should change urgency and operator visibility, not change your belief about whether the error is permanent**. Use the error itself, current observed state, API contract, and elapsed-time budget to determine that. A thousand `InvalidParameter` responses do not become more permanent than the first; conversely, ten `503`s do not become non-retryable merely because there were ten of them.

For the “blocked but still hourly” category, your current behavior has a strong precedent in Kubernetes-style reconciliation—but I would make those retries **observational first**. For example, a permission failure can start with a cheap `GET/Describe` or credential probe rather than replaying an expensive mutation every hour. And an invalid user specification does not need an hourly call at all if the only thing that can repair it is a new generation of the resource.

The other thing I would borrow directly from Crossplane is a special **`UnknownOutcome`/`Indeterminate` state around non-idempotent creates**. Persist an operation/idempotency key *before* issuing the remote mutation. Reuse it on every retry. If the remote API offers no token and you lose the response, search/observe using a unique external identity before issuing another create. If you still cannot distinguish “created” from “not created,” stopping for an operator is safer than either exponential or hourly retries. Crossplane’s decision here is deliberately conservative because a duplicate VPC/database/account can be more damaging than a resource that needs manual intervention. ([Crossplane Documentation](https://docs.crossplane.io/v2.3/managed-resources/managed-resources/?utm_source=chatgpt.com))

The mature-system consensus is therefore less “retry forever” or “give up after five” than:

**Retry known transient failures aggressively but boundedly; park externally remediable failures visibly and cheaply; fail deterministic bad input until the input changes; and never blindly retry a mutation whose first outcome is unknown.** That gives you the eventual convergence property of a control plane without turning permanent faults into API traffic or ambiguous creates into duplicated infrastructure.

---

If you want, I can:

- Explain how to implement idempotency tokens for safe retries
- Describe design considerations for operator-visible retry states
- Outline a state machine modeling retry outcomes and scheduling
