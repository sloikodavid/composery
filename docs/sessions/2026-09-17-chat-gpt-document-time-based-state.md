# Document Time Based State

Source: https://chatgpt.com/share/6aac0b5a-f9f4-83ed-addc-a95e3e771ddb

---

## Turn 1: User

_2026-09-17T13:58:22.899Z_

As of September 2026, for Convex specifically and for reactive or subscription-based backends generally (Firebase, Supabase Realtime, Hasura subscriptions), document how applications represent state that becomes stale as time passes when queries must not read the clock: materialising time-based flags with scheduled writes, passing the current time from the client, publishing an explicit "valid until" timestamp, or a watchdog job. For each approach, report what it costs in writes and invalidations at scale, how it behaves when the scheduler itself stops, and examples from real codebases. Include Convex's own documentation and its community discussions, with dates.

---

## Turn 2: ChatGPT

_2026-09-17T13:58:41.698Z_

I’ll separate the patterns by where “time” lives (materialized state, client input, validity metadata, or watchdog), then quantify the write/invalidation behavior and failure mode. I’ll anchor the Convex section in its docs/community history and use public code examples for the broader ecosystem.

---

## Turn 3: ChatGPT

_2026-09-17T13:59:13.922Z_

One important distinction is emerging: Convex is dependency-driven, so wall-clock passage is not a reactive dependency; Hasura live queries are polling-based, so its failure/cost profile is somewhat different even when the application chooses not to put `now()` into the query. I’ll preserve that distinction rather than flattening all “realtime” systems into one model.

---

## Turn 4: ChatGPT

_2026-09-17T14:03:01.580Z_

The cost picture is also backend-specific: in Firestore a materializing write can fan out into billable listener reads; in Supabase Postgres Changes, each row change may require per-subscriber authorization work; in Convex, the main penalty is query invalidation/recomputation and result fanout. So I’m reporting “writes” and “invalidations/refresh work” separately rather than pretending they have the same billing unit.

---

## Turn 5: ChatGPT

_2026-09-17T14:05:50.426Z_

# Time-derived state in reactive backends — September 2026

As of **17 September 2026**, Convex's rule is subtle: `Date.now()` is technically available in queries, and Convex freezes the clock for the duration of each function execution to preserve determinism. But passage of wall-clock time is **not a reactive dependency**. A subscription reruns when its database dependencies change, not when the frozen value of `Date.now()` would be different. Convex's current Best Practices therefore explicitly says **“Don’t use `Date.now()` in queries”** and recommends either materializing a time-dependent field with a scheduled mutation or passing a coarse current/target time as a query argument. ([Convex Developer Hub](https://docs.convex.dev/functions/runtimes))

That same underlying problem exists in Firestore and Supabase Realtime: their realtime mechanisms are driven by **data changes**, not merely by time passing. Hasura GraphQL Engine v2 is an important exception because its classic live queries periodically re-execute SQL; a SQL expression containing `now()` can therefore change without a database write. I treat the user's “queries must not read the clock” constraint as an architectural rule for Hasura rather than a technical limitation of Hasura itself. ([Firebase](https://firebase.google.com/docs/firestore/query-data/get-data?utm_source=chatgpt.com))

For the scale discussion below, let **E** be the number of time-boundary transitions per second, **S** the average number of subscribers affected by one transition, **C** the number of active clients, **Δ** a client clock-refresh interval, and **P** a watchdog interval.

| Representation | Writes at the time boundary | Reactive work / invalidations | Failure when scheduling/timers stop |
|---|---:|---:|---|
| **Materialized flag** such as `isReleased`, `online`, `expired` | ≈ **E** document writes; two boundaries mean ≈2E | Roughly proportional to **E × S**, although caching/multiplexing can make the database computation much cheaper than that | Flag freezes in its last value until the delayed job executes |
| **Client passes `now`** | **0** DB writes | Up to **C / Δ** argument changes/resubscriptions; cache sharing is possible when clients use the same coarse bucket | No server scheduler dependency; sleeping/background clients can remain stale |
| **Publish `validUntil`** | **0 writes at expiry**; normally one timestamp write when the state is created/renewed | **0 backend invalidations at expiry**; only local UI timers or optional refetches | Graceful against server-scheduler failure; consumers can independently notice expiry |
| **Watchdog / sweeper** | ≈ **E** writes if it only writes actual transitions | Scheduler runs ≈1/P plus reads/scans; invalidations ≈E × S | State freezes during outage; a deadline-based watchdog can catch up overdue records on restart |

These are logical costs. The actual expensive unit differs substantially between Convex, Firestore, Supabase and Hasura.

## 1. Materializing a time-based flag with a scheduled write

This is the **current first-class Convex recommendation**. Convex's documentation gives exactly the example of replacing a query such as `releasedAt <= Date.now()` with an indexed `isReleased === true`, where a scheduled function flips `isReleased` after `releasedAt`. The important property is that time has been converted into an ordinary database mutation, and that mutation is something Convex's dependency tracker can react to. ([Convex Developer Hub](https://docs.convex.dev/understanding/best-practices?utm_source=chatgpt.com))

For one-shot deadlines, the asymptotic cost is attractive: **one scheduled event and one state write per transition**, rather than a periodic write per object. Queries depending on that flag are invalidated only at the meaningful transition. Convex scheduled functions are themselves durable database records; the documentation says they survive unexpected downtime and system restarts. Scheduled **mutations** are guaranteed exactly once and retried on transient errors, while scheduled **actions** are at-most-once and are not automatically retried. Current platform limits include **1,000,000 outstanding scheduled functions** and up to 1,000 functions scheduled by one mutation, so “one timer per object” can eventually become a capacity consideration. ([Convex Developer Hub](https://docs.convex.dev/scheduling/scheduled-functions?utm_source=chatgpt.com))

The invalidation side can dominate the write side. Convex currently counts subscription updates as function calls, but identical query+argument combinations can share the query cache, and cached results do not consume database bandwidth. Thus a transition visible to 10,000 subscribers is conceptually 10,000 subscriber updates even though it need not mean 10,000 independent database computations. ([Convex Developer Hub](https://docs.convex.dev/production/state/limits?utm_source=chatgpt.com))

Convex's older **“Queries that scale”** article gives a useful empirical illustration. Ten users heartbeating every ten seconds cause a presence query depending directly on heartbeats to be invalidated about once a second; 100 users make that about once every 0.1 seconds. Its optimized version separates high-churn heartbeat documents from an `isOnline` presence document and uses a ten-second cron to write the presence document only when online status actually changes. That turns “every heartbeat is a visible invalidation” into “only join/leave transitions are visible invalidations.” ([Stack by Convex](https://stack.convex.dev/queries-that-scale?utm_source=chatgpt.com))

If the scheduler genuinely stops rather than merely suffering an ordinary Convex restart, the weakness is straightforward: **the materialized flag lies by omission**. An item whose `validUntil` has passed can remain `isValid: true`. Convex's durability protects against ordinary deployment/runtime interruption, but no scheduler can materialize a transition while the scheduling subsystem is indefinitely unavailable. Recurring Convex cron jobs have an additional detail: if a run is still executing when the next is due, later runs can be skipped rather than accumulating indefinitely. ([Convex Developer Hub](https://docs.convex.dev/scheduling/scheduled-functions?utm_source=chatgpt.com))

The analogous costs elsewhere are more explicit. In **Firestore Standard**, one materializing `update()` is one document write, and every affected document added to, updated in, or removed from a listener's result set normally produces a billable listener read for each client. A state transition observed by S listeners can therefore be approximately **1 write + S realtime document reads**. Google's guidance also says long-lived listeners are generally cheaper than repeatedly issuing new queries. ([Firebase](https://firebase.google.com/docs/firestore/pricing?utm_source=chatgpt.com))

Firebase's official functions-samples repository contains both scheduled cleanup examples and a Firestore presence example, so this is not merely theoretical. Scheduled Firebase functions use Cloud Scheduler; Firebase explicitly warns that a scheduled function can be invoked multiple times and that one invocation can overlap the previous one, making idempotent transitions important. ([GitHub](https://github.com/firebase/functions-samples?utm_source=chatgpt.com))

For **Supabase Postgres Changes**, one materializing `UPDATE` becomes one WAL change, but authorization makes fan-out expensive: Supabase documents that a single row change with 100 subscribed users entails **100 authorization checks**, and recommends Broadcast rather than Postgres Changes once many thousands of users subscribe to the same changes. Supabase currently gives about **3,000 same-change subscribers** as the point where Broadcast should be considered. ([Supabase](https://supabase.com/docs/guides/realtime/benchmarks?utm_source=chatgpt.com))

## 2. Passing the current time from the client

Convex documents this as the principal alternative to materialization: pass the target/current time as an explicit query argument, but **do not change it unnecessarily often**. Its documentation specifically suggests rounding down to something like the most recent minute so that clients within that minute use identical arguments and can reuse cached results. ([Convex Developer Hub](https://docs.convex.dev/understanding/best-practices?utm_source=chatgpt.com))

There are no database writes, but time becomes part of the **subscription identity/cache key**. At C clients refreshing every Δ seconds, the upper-bound churn is roughly **C/Δ argument changes per second**. If 100,000 clients all independently send millisecond-precise timestamps, nearly every subscription is distinct. If they all use the same minute bucket, clients with otherwise identical arguments can converge on the same cached Convex result. ([Convex Developer Hub](https://docs.convex.dev/functions/query-functions?utm_source=chatgpt.com))

There is unusually good real-world evidence of the failure mode in Convex's own components directory. On **3 April 2026**, the project's changelog records an infinite rerender caused by putting `Date.now()` directly into `useQuery` arguments: every render generated different arguments and therefore another subscription. The fix memoized a value rounded to the nearest minute. On **27 July 2026**, a different settings panel was found never to finish loading because `useQuery(..., {now: Date.now()})` continually resubscribed before the previous subscription settled; that code had been introduced on **26 March 2026** when a tooling pass correctly moved `Date.now()` out of a server query but put it into an unstable client argument. The eventual fix captured the timestamp once with `useState`. ([GitHub](https://github.com/get-convex/components-submissions-directory/blob/main/changelog.md?utm_source=chatgpt.com))

Scheduler failure is not a concern here because there is no server scheduler. Instead, **the client is the scheduler**. A backgrounded browser tab, suspended mobile app, crashed JavaScript timer, offline device, or badly skewed clock can retain an old bucket. This makes the technique good for presentation and approximate filtering but poor for security-sensitive expiry. A client-supplied clock should not be the authority for an authorization or payment decision.

The economics elsewhere are less favorable if “passing now” means repeatedly rebuilding a query. In Firestore, reconnecting/reissuing the query can incur the initial result-set reads again; Google's own scaling guidance consequently recommends keeping listeners long-lived where possible. Supabase Postgres Changes is even less naturally suited to this technique: changing a cutoff does not itself generate a WAL event for old rows, so an application generally needs an ordinary SQL refetch and/or a replacement subscription rather than expecting Realtime to re-evaluate existing rows. ([Firebase](https://firebase.google.com/docs/firestore/real-time_queries_at_scale?utm_source=chatgpt.com))

Hasura has real code using the client-time variant. Its `learn-graphql` sample contains an `updateLastSeen($now: timestamptz!)` mutation whose timestamp is supplied by the client, alongside a subscription to online users. That's passing time into a write rather than directly into the subscription, but it demonstrates the same “make time explicit input data” technique in a production-style GraphQL codebase. ([GitHub](https://github.com/hasura/learn-graphql/blob/master/tutorials/mobile/android-apollo/app-final/app/src/main/graphql/com/hasura/todo/api.graphql?utm_source=chatgpt.com))

## 3. Publishing an explicit `validUntil`

This is a **lease/deadline representation**:

`{ state: "active", validUntil: 1790000000000 }`

The backend does not need to manufacture another write at the expiration instant. A client renders the state only while its local clock is before `validUntil`, and can set one timer to hide it, refresh it, or ask the server for newer state at the deadline.

The scale property is excellent: **zero backend writes and zero backend subscription invalidations merely because the deadline passed**. You normally pay a write only when the lease is initially published or renewed. If a million clients have the same lease, expiration means a million inexpensive local comparisons/timers rather than one backend update fanning out to a million subscriptions. If every client refetches simultaneously at expiry, of course, that simply moves the thundering herd from writes to reads; adding jitter or having a shared next-state event is useful at that scale.

This pattern is also the best of the four under a scheduler outage. Even if the service that was supposed to materialize `isExpired=true` never executes, a consumer holding `{validUntil}` has enough information to stop treating the value as fresh. The limitation is that this guarantee is **consumer-side**. A server process that must make an authoritative decision still needs a trusted clock or an already-materialized server state, and suspended clients can display the previous state until they wake.

Two major realtime client libraries use precisely this pattern for credentials. Convex's own `convex-js` authentication manager reads the JWT's `iat` and `exp`, estimates server/client clock skew, and installs a `setTimeout` to refetch before `exp`; its comments explicitly describe the token expiry as the point used to schedule the next refresh. ([GitHub](https://github.com/get-convex/convex-js/blob/main/src/browser/sync/authentication_manager.ts?utm_source=chatgpt.com)) Supabase Auth exposes both `expires_in` and an absolute `expires_at`; its client code checks that deadline and refreshes sessions near expiry. A 2026 Supabase issue quotes the SDK's `< 90 seconds` expiry path, which is a concrete example of a published deadline controlling local freshness without a database invalidation. ([GitHub](https://github.com/supabase/auth-js/blob/master/src/lib/types.ts?utm_source=chatgpt.com))

Firestore TTL fields superficially resemble `validUntil`, but **TTL should not be mistaken for an exact state transition**. Google's current documentation says expired documents typically disappear within **24 hours**, and they continue to be returned from queries until deletion actually occurs. A TTL field is therefore excellent cleanup metadata, while the application should inspect the deadline itself or materialize a separate exact state if “expired at 12:00:00” matters. ([Firebase](https://firebase.google.com/docs/firestore/enterprise/ttl?utm_source=chatgpt.com))

## 4. A watchdog / sweeper job

The watchdog representation stores the durable cause of staleness—typically `lastSeen`, `deadline` or `validUntil`—and periodically or adaptively finds overdue records and materializes only the ones whose semantic state has actually changed.

A naive watchdog scanning M records every P seconds costs roughly **M/P record inspections per second**, even when nothing expires. An indexed watchdog over `deadline` can instead seek to `deadline <= now` and process only D due records, while a still better implementation sleeps until the earliest outstanding deadline. Writes remain approximately **E**, i.e. one per real state transition. The watchdog trades one-scheduled-job-per-object for recurring read work and much smaller scheduler cardinality.

The current **`get-convex/presence`** component is an unusually clean real implementation. Heartbeats update a session's `deadline`, but subscribers read separate `presence` documents. A single deployment-wide batch-worker waits until the next session timeout, fetches expired sessions through a deadline index in batches of **64**, and changes `presence.online` only when the final session for a user disappears. Its README explicitly says the design avoids re-running client queries on every heartbeat and that clients receive updates only when users join or leave. ([GitHub](https://github.com/get-convex/presence?utm_source=chatgpt.com))

That code also shows a useful recovery property. Its work query searches `deadline <= now`; therefore, if execution resumes late, overdue rows are still overdue and can be drained. Convex's underlying batch-worker separately has a liveness monitor that restarts a worker loop if it dies unexpectedly. A total scheduler outage still freezes time-based transitions, but once scheduling returns the state can **catch up from durable deadlines**, rather than depending on having observed every individual clock tick. ([GitHub](https://github.com/get-convex/presence/blob/main/src/component/public.ts?utm_source=chatgpt.com))

Supabase's analogous server-side primitive is its `pg_cron`-based Cron feature. Jobs can run from every second to annually and can execute SQL directly; Supabase recommends no more than eight concurrent jobs and keeping each under ten minutes. A resilient expiry watchdog should therefore query “all records whose deadline is now in the past,” not merely “records that were supposed to expire during this exact cron interval,” so a missed interval becomes recoverable. ([Supabase](https://supabase.com/docs/guides/cron?utm_source=chatgpt.com))

## The Hasura exception

Hasura GraphQL Engine v2 deserves separate treatment because its classic live-query implementation is itself a watchdog of sorts. Hasura's architecture document says it eventually chose **interval-based polling** of multiplexed live queries rather than relying on database change events. The current GraphQL Engine configuration still has `HASURA_GRAPHQL_LIVE_QUERIES_MULTIPLEXED_REFETCH_INTERVAL`, with a default of **1000 ms**, and a default multiplexed batch size of 100. ([GitHub](https://github.com/hasura/graphql-engine/blob/master/architecture/live-queries.md?utm_source=chatgpt.com))

Consequently, unlike Convex, a Hasura v2 subscription backed by a Postgres view containing `now()` can genuinely change just because time passes. Hasura's official **2 February 2022** realtime-chat tutorial does exactly that: `user_online` is a view selecting rows where `last_seen > now() - interval '10 seconds'`, while clients update `last_seen` every two seconds. ([Hasura](https://hasura.io/blog/building-a-realtime-chat-app-with-graphql-subscriptions-d68cd33e73f?utm_source=chatgpt.com))

If the application nevertheless imposes the no-clock rule—for deterministic caching, portability, easier testing, or consistency with other event-driven systems—the same four patterns apply. But the scale tradeoff differs: Hasura is already periodically re-executing live SQL and multiplexes equivalent subscriptions. Its 2019 architecture benchmark demonstrated one million active live queries by batching subscribers rather than issuing one independent SQL query per socket. ([Hasura](https://hasura.io/blog/1-million-active-graphql-subscriptions?utm_source=chatgpt.com))

## Convex documentation and community history

There has been some evolution in Convex examples, which is worth recording rather than treating all historical snippets as present-day guidance.

| Date | Convex source | What it shows |
|---|---|---|
| **17 Sep 2026 — current docs** | Best Practices | Explicitly says not to use `Date.now()` inside reactive queries; recommends a scheduled materialized field or a coarse time argument. ([Convex Developer Hub](https://docs.convex.dev/understanding/best-practices?utm_source=chatgpt.com)) |
| **Current Stack page, labelled “4 years ago”** | *Implementing Presence with Convex* | Older design keeps `lastSeen`, computes online/offline locally with `Date.now()`, and uses a browser `setInterval` solely to recompute UI—no new network request—illustrating the “published timestamp + local clock” approach. ([Stack by Convex](https://stack.convex.dev/presence-with-convex)) |
| **Current Stack page, labelled “3 years ago”** | *Queries that scale* | Moves heartbeats off heavily subscribed documents and uses a ten-second cron to materialize `isOnline`, explicitly quantifying the heartbeat invalidation problem. ([Stack by Convex](https://stack.convex.dev/queries-that-scale)) |
| **24 Dec 2024** | Community aggregate discussion | Convex staff/community guidance notes scheduled mutations' exactly-once property while warning that high write conflicts can make completion take longer. ([Convex Community](https://discord-questions.convex.dev/m/1321042855262945371?utm_source=chatgpt.com)) |
| **1 Feb 2025** | Community “Table Aggregate Component Question” | A user proposes `Date.now()` bounds for a “past N days” aggregate and receives “looks good” feedback. This is valid for computing a result **when the query runs**, but does not by itself make an already-open reactive result advance as time passes; current Best Practices is the stronger guidance for subscriptions. ([Convex Community](https://discord-questions.convex.dev/m/1335280215148199976?utm_source=chatgpt.com)) |
| **2 Apr 2025** | Community pricing discussion | In the example of one write reaching 1,000 connected UIs, Convex staff confirms that subscription updates count as function calls on the Pro pricing model, while identical cached results avoid repeated DB-bandwidth charges. Current official limits likewise state that subscription updates count as function calls. ([Convex Community](https://discord-questions.convex.dev/m/1357041598965485659?utm_source=chatgpt.com)) |
| **3 Apr & 27 Jul 2026** | `components-submissions-directory` changelog | Concrete production bugs caused by putting fresh `Date.now()` values into `useQuery` arguments; fixes stabilize or minute-bucket the client time. ([GitHub](https://github.com/get-convex/components-submissions-directory/blob/main/changelog.md?utm_source=chatgpt.com)) |

The exact dates on the Discord rows above are derived from the public Discord snowflake IDs in the archived thread URLs; the archive UI itself displays relative ages.

## Practical synthesis

For **Convex in particular**, a useful default is to store the underlying deadline and then choose whether a materialized flag is actually needed. If you need an index such as `by_isReleased`, or other server-side queries need the state without supplying a time argument, schedule an idempotent mutation at the boundary. For very high cardinality, prefer an indexed deadline watchdog or next-deadline worker over millions of independent timers. The current Convex presence component is a strong reference architecture for that design. ([Convex Developer Hub](https://docs.convex.dev/understanding/best-practices?utm_source=chatgpt.com))

Where the time-dependent state is primarily presentational, **`validUntil` is the cheapest and most failure-tolerant representation**: no write or global invalidation is required at expiration. Client-supplied `now` is similar but should be coarsened and used deliberately; a millisecond-precise timestamp passed through every render turns time itself into subscription churn. Materialized flags are appropriate when the backend must be able to query/index the current categorical state, and watchdogs are the scalable way to maintain such flags when one durable timer per object becomes undesirable.

The especially robust combination is therefore **deadline + optional materialized flag + catch-up watchdog**: the timestamp remains the durable truth, the boolean provides cheap indexed reactive queries, and the watchdog repairs missed transitions by querying overdue deadlines after an outage. This architecture confines normal invalidations to real semantic transitions while ensuring that a stalled scheduler does not destroy the information needed to determine what should have expired.

---

If you want, I can:

- Explain practical trade-offs for using materialized flags versus validUntil timestamps
- Describe Convex's recommended pattern combining deadline, materialized flag, and watchdog
- Summarize recent Convex community incidents related to passing client time as query arguments
