# Document Convex polling limits

Source: https://chatgpt.com/share/6aac0b93-fabc-83eb-b033-f1cec1beb1a8

---

## Turn 1: User

_2026-09-17T13:59:09.113Z_

As of September 2026, for Convex 1.45 or later and the `@convex-dev/workpool` and `@convex-dev/rate-limiter` components, document the practical limits of a design in which every one of several thousand documents is re-examined on a schedule by an action that calls an external API: how many scheduled functions and workpool items a deployment handles, cost per invocation, how cron sweeps that enqueue due work should be bounded, how optimistic-concurrency conflicts on shared documents such as a rate-limiter bucket behave under load, and what Convex recommends instead for polling many external resources. Distinguish documentation from community reports, with dates.

---

## Turn 2: ChatGPT

_2026-09-17T13:59:14.713Z_

I’ll separate **official Convex/component documentation** from **community-reported behavior**, and date each source so it’s clear what is guaranteed versus anecdotal. I’ll also distinguish hard platform limits from practical scaling limits that arise from queueing, cron batching, and optimistic concurrency.

---

## Turn 3: ChatGPT

_2026-09-17T13:59:29.767Z_

One important distinction is already clear from the current docs: the platform can hold **up to 1,000,000 outstanding scheduled functions**, but that is not a recommendation to create one durable timer per polled document. Workpool adds its own coordination calls and Convex explicitly recommends batching when async volume is large.

---

## Turn 4: ChatGPT

_2026-09-17T14:00:26.506Z_

The concurrency story is also different from the queue-capacity story. On current deployment classes, scheduled-job execution is capped at **8 / 256 / 512 / 1,024 concurrent jobs** (S16/S256/D1024/D2048), while Workpool’s own guidance is much lower—roughly **≤20 total parallelism on Free and ≤100 on Pro across Workpools/Workflows**—so background polling leaves headroom for live traffic.

---

## Turn 5: ChatGPT

_2026-09-17T14:01:32.153Z_

As of **17 September 2026**, the practical answer is: **several thousand resources are not inherently too many for Convex, but “one independently scheduled action per document, forever” is usually the wrong shape**. The hard scheduler capacity is large; the practical constraints are scheduler concurrency, Workpool overhead, external-API rate limits, function-call cost, and contention on shared transactional state.

Convex **1.45.0 shipped 21 August 2026**; the limits below are deployment/platform limits rather than something newly introduced by 1.45. ([Ship](https://ship.convex.dev/))

### Current documented limits

| Area | Current documented behavior | Practical implication |
|---|---|---|
| Outstanding scheduled functions | **1,000,000 per deployment** | A few thousand future timers fit comfortably in the hard limit. This does **not** mean Convex recommends one perpetual timer per resource. ([Convex Developer Hub](https://docs.convex.dev/production/state/limits?utm_source=chatgpt.com)) |
| Scheduling from one mutation | **1,000 functions**, with scheduled-function args subject to size limits | A mutation cannot directly fan out 5,000 `scheduler.runAfter` calls in one transaction. ([Convex Developer Hub](https://docs.convex.dev/production/state/limits?utm_source=chatgpt.com)) |
| Concurrent scheduled jobs | **S16: 8; S256: 256; D1024: 512; D2048: 1,024** | Thousands becoming due simultaneously produce a queue/backlog rather than thousands running simultaneously. Free/Starter are S16; Professional is S256. ([Convex Developer Hub](https://docs.convex.dev/production/state/limits?utm_source=chatgpt.com)) |
| Action concurrency | Convex-runtime actions: **64 / 512 / 1,024 / 2,048** by deployment class; Node actions: **64 / 256 / 1,024 / 2,048** | Scheduler capacity and action capacity are separate ceilings. ([Convex Developer Hub](https://docs.convex.dev/production/state/limits?utm_source=chatgpt.com)) |
| Workpool parallelism | Component docs say avoid exceeding **20 on Free, 100 on Pro**, summed across Workpools/Workflows | This is the more useful operational ceiling for background API work because it preserves capacity for normal app traffic. ([GitHub](https://github.com/get-convex/workpool?utm_source=chatgpt.com)) |
| Workpool backlog | **No documented numeric maximum number of queued Workpool items** | Workpool intentionally keeps backlog in component tables and only presents roughly `maxParallelism` work to the underlying scheduler at once. Thousands queued are qualitatively different from thousands of scheduler jobs simultaneously in flight. ([Stack by Convex](https://stack.convex.dev/advanced-serverless-queuing-with-workpool-component)) |
| Transaction limits | 32,000 docs scanned, 16 MiB read, 16 MiB written, 16,000 docs written; mutations have a 1-second user-code budget | These limits, rather than total table cardinality, constrain a cron sweep that discovers due records. ([Convex Developer Hub](https://docs.convex.dev/production/state/limits?utm_source=chatgpt.com)) |

That Workpool distinction is important. In Convex's official engineering explanation from **approximately April 2026** (the article is currently labelled “5 months ago”), Workpool is described as storing the backlog in its own `work`/pending tables and only handing the scheduler as many jobs as the pool's parallelism permits. A Workpool with `maxParallelism: 10` can therefore have a large backlog while the scheduler sees about ten of its tasks in flight. ([Stack by Convex](https://stack.convex.dev/advanced-serverless-queuing-with-workpool-component))

There is **no official “Workpool supports N items” number analogous to the 1,000,000 scheduled-function limit**. Treat the Workpool backlog as ordinary component/database state subject to database size, document-size and transaction limits. The official Workpool material also explicitly says it has coordination overhead, recommends batching with `enqueueActionBatch`, and cautions against creating too many separate pools. ([GitHub](https://github.com/get-convex/workpool?utm_source=chatgpt.com))

### Cost per poll

Under the current pricing documentation, one function call is not expensive individually, but perpetual per-document polling multiplies quickly. Professional and serverless Business/Enterprise marginal function-call pricing is **$2 per million calls = $0.000002 per call** after the included allocation; Starter overage is **$2.20 per million = $0.0000022 per call**. Dedicated Business/Enterprise is **$0.20 per million**. EU-region quoted resource prices are 1.3× the US figures. Scheduled executions explicitly count as function calls. ([Convex Developer Hub](https://docs.convex.dev/production/state/limits?utm_source=chatgpt.com))

An external-API poll generally costs more than that one number. The action execution is a function call, action compute is separately metered once the plan's included allowance is exhausted, outgoing data contributes to egress, and the external API may charge its own fee. An action's `ctx.runQuery`, `ctx.runMutation`, or `ctx.runAction` calls can also add function executions; Convex specifically recommends batching database access from actions because multiple `run*` calls mean multiple function calls. ([Convex Developer Hub](https://docs.convex.dev/functions/actions?utm_source=chatgpt.com))

Also, **a Workpool item does not have a documented fixed “X function calls per job” multiplier**. Enqueueing, queue-loop coordination, execution wrappers, retries and `onComplete` can all cause additional component/function executions, and the exact number depends on configuration and batching. Consequently, estimating “5,000 polls = exactly 5,000 Convex calls” will understate a Workpool implementation's Convex overhead. Workpool's own documentation calls this overhead out and recommends batch enqueueing. ([GitHub](https://github.com/get-convex/workpool?utm_source=chatgpt.com))

For scale intuition only: 5,000 resources polled hourly mean **3.6 million external-poll actions in a 30-day month**; every five minutes means **43.2 million**. Those figures are before Workpool coordination/retries and before other application traffic. The included Professional allowance is currently 25 million calls/month, so frequency matters much more than whether the initial resource count is 3,000 versus 6,000. ([Convex Developer Hub](https://docs.convex.dev/production/state/limits?utm_source=chatgpt.com))

### How to bound the cron sweep

A cron that periodically says “find everything whose `nextCheckAt <= now` and enqueue it” should **not `.collect()` every overdue document and fan them all out**. Convex's scalable-query guidance is to use a selective index plus `.take()`/pagination for large sets, and Workpool recommends batch enqueueing. ([Stack by Convex](https://stack.convex.dev/queries-that-scale?utm_source=chatgpt.com))

The robust shape is an index such as `by_nextCheckAt`, a **fixed-size page of due records**, and a cursor/continuation. Claim or advance those records transactionally, enqueue that page—preferably through `enqueueActionBatch`—and, if more due work remains, schedule another sweep/continuation. The page should remain comfortably below the 1,000-schedules-per-mutation ceiling and below transaction read/write budgets. There is no Convex-documented magic batch size; “tens to low hundreds rather than thousands in one mutation” is an engineering starting point, not a platform guarantee.

There is now an even more direct official primitive. The **`@convex-dev/batch-worker` repository appeared 5 September 2026**, and the current Convex Components page describes Batch Worker specifically as a self-recovering, cursor-driven table queue with exactly one loop per named worker, snapshot reads to avoid OCC conflicts with concurrent inserts, debouncing, and integration with Workpool and Rate Limiter. For work needing an external API, its documented pattern is: claim a bounded batch in a mutation, then schedule/enqueue an action to perform the external calls. ([GitHub](https://github.com/?utm_source=chatgpt.com))

That is a materially better fit than a cron repeatedly discovering thousands of records from scratch.

### Shared rate-limit buckets and OCC under load

The current `@convex-dev/rate-limiter` documentation is quite explicit. A non-sharded global rate limit is shared state. If many workers concurrently consume the same bucket, they try to modify the same database value. Convex's serializable transactions prevent lost updates or accidental over-admission: two conflicting mutations cannot both silently overwrite each other. Instead, **optimistic-concurrency conflicts cause retries with backoff**. Under enough sustained contention, retries are wasteful and can eventually fail, so the component recommends sharding high-throughput limits. ([GitHub](https://github.com/get-convex/rate-limiter?utm_source=chatgpt.com))

The documented rough sizing guidance is to take expected maximum QPS and divide by about two for the shard count, while keeping at least five—and ideally ten or more—units of capacity per shard. Their 1,000-QPM example uses ten shards. Sharding may occasionally reject a request even though another shard still has capacity, but it preserves the global upper bound. `reserve: true` is also important for background work: rather than having a herd of actions repeatedly race for the next token, workers can reserve future capacity and schedule themselves for `retryAfter`. ([GitHub](https://github.com/get-convex/rate-limiter?utm_source=chatgpt.com))

Workpool parallelism and Rate Limiter sharding solve different problems. Reducing Workpool parallelism reduces how many requests contend simultaneously; sharding reduces how many of those requests touch the same rate-limit document. For a several-thousand-resource poller, using a high Workpool parallelism against **one unsharded global bucket** is precisely the pattern to avoid.

There is useful **community production evidence**, but it should not be confused with a documented guarantee. On **28 August 2026**, a user filed `get-convex/better-auth#432` reporting a hot database-backed Better Auth rate-limit row. Their SSR setup funneled requests into one `ip|path` document; bursts exhausted OCC retries, reportedly causing about **80 failed auth requests in 30 days in production and several hundred in staging**. ([GitHub](https://github.com/get-convex/better-auth/issues/432?utm_source=chatgpt.com)) This was **not a bug report against `@convex-dev/rate-limiter` itself**—the Better Auth adapter was using its own read/modify/write path—but it is a concrete production report of the generic Convex failure mode that the official Rate Limiter's sharding feature is designed to mitigate.

### What Convex recommends instead of thousands of independent pollers

The strongest conclusion from the September 2026 official material is **event-driven ingestion where available, otherwise one bounded queue/worker—not one autonomous polling schedule per resource**.

Convex's HTTP Actions documentation explicitly presents HTTP actions as the endpoint for receiving third-party webhooks. ([Convex Developer Hub](https://docs.convex.dev/functions/http-actions?utm_source=chatgpt.com)) Official component patterns reinforce that preference: for example, the current Firecrawl Convex integration advances long-running crawls primarily through **webhook delivery**, with polling described as a fallback for local development. ([Convex](https://www.convex.dev/components/firecrawl/firecrawl-convex?utm_source=chatgpt.com)) Convex's RunPod walkthrough similarly shows the external worker writing progress directly back to Convex, eliminating status polling entirely. ([Stack by Convex](https://stack.convex.dev/?utm_source=chatgpt.com))

Where the provider offers no callback/webhook mechanism, the current Convex-native design is a **table containing `nextCheckAt`/state, one Batch Worker or bounded cron sweep to pull due records, a Workpool to cap concurrent actions, and a sharded/reservable Rate Limiter to respect provider quotas**. For much more specialized high-volume queueing, Convex's own Workpool engineering article says an external managed queue/worker is also valid, with Convex serving as the reactive database/glue layer. ([Stack by Convex](https://stack.convex.dev/advanced-serverless-queuing-with-workpool-component?utm_source=chatgpt.com))

So for “several thousand documents,” I would not regard the **1,000,000 scheduled-function capacity** as the design target. The scalable target is **a small number of durable worker loops plus a table-backed backlog**. That keeps scheduler usage bounded, lets polling cadence adapt to actual due work and API capacity, avoids a synchronized thundering herd, and makes the rate limiter's contention manageable.

I can also monitor Convex's scheduler, Workpool, Batch Worker, and Rate Limiter release notes and alert you if these limits or recommendations change.

---

If you want, I can:

- Explain how to implement a Workpool-based polling system
- Outline best practices to avoid optimistic concurrency conflicts
- Describe cost implications of polling thousands of external APIs
