# Document Clerk Rate Limits

Source: https://chatgpt.com/share/6aac0b8b-ec28-83eb-b3ea-03a8b3f6d5a8

---

## Turn 1: User

_2026-09-17T13:59:16.001Z_

As of September 2026, from Clerk's documentation and SDK source, document the Backend API rate limits for development and production instances, the maximum `limit` for `GET /users`, the maximum number of `user_id` values accepted in one list request, how `offset` pagination behaves when users are created or deleted during paging, and whether Clerk offers a change feed or export better suited to reconciling a local copy of all users. Report what applications that mirror Clerk users at tens of thousands of users do.

---

## Turn 2: ChatGPT

_2026-09-17T13:59:19.355Z_

I’ll cross-check Clerk’s current documentation against SDK/API source and changelog material, then separate hard limits from operational guidance. I’ll also look for evidence on how large user mirrors are typically kept consistent rather than relying on offset scans alone.

---

## Turn 3: ChatGPT

_2026-09-17T13:59:35.058Z_

The hard limits are already clear in Clerk’s current docs: production is 1,000 Backend API requests per 10 seconds, development 100/10s; `GET /users` caps `limit` at 500 and accepts up to 100 `user_id` filters per request. The important remaining question is consistency: whether offset paging is snapshot-like (it does not appear to be) and what Clerk exposes for repair/reconciliation.

---

## Turn 4: ChatGPT

_2026-09-17T14:01:30.013Z_

As of **17 September 2026**, Clerk’s public documentation and current SDK source point to a fairly clear model: use the Backend API for bulk/backfill and occasional reconciliation, and use webhooks for the ongoing mirror. `GET /users` is not a snapshot or cursor-based feed.

| Item | Current behavior |
|---|---|
| Backend API rate limit, production | **1,000 requests / 10 seconds**, per application instance |
| Backend API rate limit, development | **100 requests / 10 seconds**, per application instance |
| `GET /users` maximum `limit` | **500** |
| Default `limit` | **10** |
| Maximum `user_id` values in a list request | **100** |
| Pagination | Offset-based: `offset=N` means skip the first N users of the result set **at the time that request runs** |
| Default ordering | `-created_at`, newest users first |
| Cursor/snapshot pagination | **No** documented cursor or snapshot facility |
| User change feed | **No public BAPI/SDK CDC/change-feed endpoint**; webhooks are the supported event mechanism |
| Bulk export | Dashboard CSV export exists, primarily for migration; no documented public user-export API suitable as a continuous reconciliation feed |

Clerk's rate-limit documentation says the general Backend API budget applies to all BAPI methods, including `GET`s, and is keyed to the application instance/Secret Key. A 429 includes `Retry-After`. `GET /users` and `/users/count` have no separately documented rate limit, so the general limit applies. ([Clerk](https://clerk.com/docs/guides/how-clerk-works/system-limits))

For listing users, the current docs explicitly say `limit` must be greater than zero and **less than 501**, `offset` skips the first N results, and `userId` accepts **up to 100 IDs**. The same page documents the default sort as descending `created_at`. ([Clerk](https://clerk.com/docs/reference/backend/user/get-user-list)) Clerk's own current Backend API skill/source material independently describes `GET /v1/users` as `limit (max 500, default 10)` and offset pagination. ([GitHub](https://github.com/clerk/skills/blob/main/skills/core/clerk-backend-api/SKILL.md))

### A significant JavaScript SDK detail

The current `@clerk/backend` JavaScript implementation is worth knowing about because `getUserList()` does **two BAPI calls**, not one. The source strips `limit`, `offset`, and `orderBy` from the count parameters and runs these in parallel:

`GET /users` plus `GET /users/count`.

The source itself calls this a temporary workaround for populating `totalCount`, and explicitly notes that the two responses can disagree if a user is created between them.  The source snapshot I checked is from Clerk's `javascript` repository at commit `804d3db...`, committed **17 September 2026**, so this is current rather than an old SDK artifact. 

That means an `@clerk/backend` full scan using `getUserList()` consumes roughly **two requests per page**. If you do not need `totalCount`, a direct `GET /v1/users` loop—or an SDK whose generated list method simply returns `List<User>`—avoids the extra count call. Clerk's current generated Python SDK, for example, exposes `users.list()` returning a list rather than synthesizing a `totalCount`. ([GitHub](https://github.com/clerk/clerk-sdk-python/blob/main/docs/sdks/users/README.md))

### What happens when the user table changes during offset paging

There is no indication of snapshot isolation. In fact, the JavaScript source's warning about `/users` and `/users/count` observing different states is direct evidence that independent requests see the live database rather than a frozen view. 

With the default `-created_at` ordering, suppose page size is two:

`[A, B, C, D, ...]`

You fetch offset 0 and receive `A,B`. If a new user `X` is then created, the live ordering becomes `[X,A,B,C,D,...]`. Your next request with `offset=2` starts at `B`, so **B is duplicated**, while `X` will generally not be encountered during that forward-moving scan. Creation at the head therefore shifts page boundaries backwards.

Deletion has the opposite, more dangerous effect. If you fetched `A,B`, then `A` is deleted, the list becomes `[B,C,D,...]`. `offset=2` now returns `D,...`, so **C was skipped entirely**. An offset scan therefore cannot be used as a proof that every live user was observed exactly once.

Sorting `+created_at` reduces the creation problem because new accounts normally append at the end, but it does **not** solve deletions before the current offset. And if you paginate by `updated_at`, ordinary profile updates themselves can move records across page boundaries.

So for reconciliation purposes, treat one offset scan as a **best-effort live enumeration**, not a transactionally consistent snapshot.

### Change feed, webhooks and exports

Clerk does not currently expose a documented public BAPI/SDK endpoint resembling `changes?since=...`, a monotonically increasing sequence, or a CDC cursor. The current BAPI is version **2026-05-12**; its webhook API manages the Svix integration, but it does not provide a user-change-feed retrieval API. ([Clerk](https://clerk.com/docs/reference/backend-api))

Instead, Clerk explicitly recommends `user.created`, `user.updated`, and `user.deleted` webhooks for keeping an external user table synchronized. Clerk also warns that webhooks are asynchronous/eventually consistent and that delivery is not absolutely guaranteed, so consumers need retry/error handling. Svix retries failed messages, and Clerk's Dashboard lets you replay an individual failed message, all failed messages in a range, or even "missing messages" following a failure. ([Clerk](https://clerk.com/docs/guides/development/webhooks/syncing))

There is now also an **Application Logs** audit trail in the Dashboard, including user activity and updates, with plan-dependent retention. But Clerk documents that as a Dashboard observability feature; I found no current public Backend SDK endpoint that turns Application Logs into a consumable reconciliation/change stream. ([Clerk](https://clerk.com/docs/guides/dashboard/logs/application-logs))

Clerk does provide an asynchronous **CSV user export** from Dashboard → Settings → User exports. It includes user data and hashed passwords and is explicitly documented under migration away from Clerk. The same migration page says the programmatic alternative is `GetUserList`. ([Clerk](https://clerk.com/docs/guides/development/migrating/overview)) In other words, the export is useful for a one-off baseline or migration, but it is not documented as an API-driven recurring reconciliation facility and does not replace webhooks.

### What production mirrors at tens of thousands of users do

Clerk's own June 2026 production-sync guidance describes the prevailing architecture: **Backend API pagination for the initial bulk backfill, then webhooks as the primary synchronization mechanism**, with a unique Clerk user ID locally, idempotent upserts, and recording the Svix message ID so duplicate deliveries are harmless. It also discusses queueing webhook work for robustness. ([Clerk](https://clerk.com/articles/how-to-sync-clerk-user-data-to-your-database?utm_source=chatgpt.com)) Clerk separately documents Inngest as an example of putting webhook delivery behind a durable queue with concurrency control and retries. ([Clerk](https://clerk.com/docs/guides/development/webhooks/inngest?utm_source=chatgpt.com))

For a mirror containing tens of thousands of users, I would translate that documented pattern into this operating model:

1. **Clerk remains the source of truth.** Subscribe to `user.created`, `user.updated`, and `user.deleted`; verify signatures; make processing idempotent; persist/queue events before doing expensive downstream work.
2. **Initial backfill with pages of 500.** At 10,000 users that is 20 raw list requests; 50,000 is 100; 100,000 is 200. If using current JS `getUserList()`, double those BAPI counts because of its parallel `/users/count`.
3. **Do not use repeated full polling as the primary sync mechanism.** Clerk explicitly positions webhooks as the scalable synchronization method and notes that webhooks do not have the BAPI request limit. ([Clerk](https://clerk.com/blog/webhooks-v-bapi))
4. **Run periodic repair/reconciliation anyway.** Full list scans at this scale are inexpensive enough to run periodically, but make every page an upsert and don't immediately delete a local row merely because one offset scan failed to see it.
5. **Verify apparent deletions before deleting locally.** This is where the 100-ID filter is particularly useful: take IDs present locally but absent from a scan and query Clerk in batches of up to 100. A missing ID after a direct/batched verification is much stronger evidence than absence from one mutable offset traversal.
6. **Use overlap rather than a brittle high-water mark for newly created users.** Clerk has `createdAtAfter`/`createdAtBefore` filters but no unique cursor tied to `created_at`; use a sliding overlap window plus idempotent upserts if you use those filters. Webhooks cover the normal case.
7. **Replay webhook failures and retain your own event bookkeeping.** Svix's replay capability is useful operationally, but a local processed-event table/queue makes duplicate and out-of-order delivery manageable. Clerk itself recommends idempotency for this synchronization pattern. ([Clerk](https://clerk.com/articles/how-to-sync-clerk-user-data-to-your-database?utm_source=chatgpt.com))

One useful consequence of the numbers is that **"tens of thousands" is not actually large for an occasional Clerk reconciliation**. A 50,000-user raw scan is only about 100 list calls at 500/page; even the current JS wrapper is about 200 BAPI calls. That is well inside the production 1,000-per-10-second headline budget if nothing else is consuming it, although production code should still throttle and respect `Retry-After` because the budget is shared by the instance. Development is much tighter: a 50,000-user JS SDK scan would exceed the 100-per-10-second development budget if fired all at once. Clerk's own migration tool consequently self-throttles to about **100 requests/sec in production and 10/sec in development**. ([GitHub](https://github.com/clerk/migration-tool/blob/main/AGENTS.md))

**Bottom line:** for a reliable local copy, I would not build around `offset` as though it were a database snapshot. Use **webhooks for the live stream + periodic `limit=500` reconciliation + batch verification of discrepancies**, with Clerk IDs and idempotent upserts as the identity mechanism. The Dashboard CSV is useful for bootstrap/migration, but Clerk currently offers no public CDC/change-feed or programmatic export that is a stronger continuous reconciliation primitive than that combination.

---

If you want, I can:

- Explain why offset pagination can cause duplicates or skips during user changes
- Describe the recommended architecture for mirroring tens of thousands of Clerk users
- Summarize Clerk's rate limits and how they affect bulk user listing
