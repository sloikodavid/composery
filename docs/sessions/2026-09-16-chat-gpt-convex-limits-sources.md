# Convex limits sources

Source: https://chatgpt.com/share/6aab2bef-c14c-83ed-80e1-d56eb578cc22

---

## Turn 1: User

_2026-09-16T22:55:04.485Z_

As of September 2026, list Convex's hard limits with sources: maximum documents read and written per mutation and query,

maximum execution time for queries, mutations and actions (Node runtime and default runtime separately), maximum

arguments and return size, maximum scheduled functions per mutation, index and pagination limits, and what error each

produces when exceeded. Note which differ between self-hosted and cloud, and which have changed across recent versions.

---

## Turn 2: ChatGPT

_2026-09-16T22:55:04.127Z_

I’ll cross-check Convex’s current docs against release notes/source so the table distinguishes cloud vs. self-hosted limits and flags limits that moved in recent versions. I’ll also separate “document count” limits from byte/transaction limits where Convex enforces both.

---

## Turn 3: ChatGPT

_2026-09-16T22:55:19.166Z_

The current cloud docs are clear on the numeric ceilings: 32,000 documents scanned, 16,000 written, 16 MiB read/written, 4,096 index ranges, 16 MiB args/returns, 1,000 scheduled functions, 1s query/mutation CPU, 30m default-runtime actions, and 10m Node actions. The less obvious part is the exact error surface and version history, which I’m validating from backend source/issues rather than assuming from the docs.

---

## Turn 4: ChatGPT

_2026-09-16T23:02:15.641Z_

One important doc/source mismatch turned up: the cloud Limits page still lists **4 MiB per scheduled function’s arguments**, but the current backend source explicitly says that 4 MiB knob is **“not currently enforced.”** I’ll flag it as a documented cloud contract, not an actually enforced self-host hard limit; the **16 MiB total scheduled-args-per-mutation** limit is enforced.

---

## Turn 5: ChatGPT

_2026-09-16T23:03:33.124Z_

As of **16 September 2026**, Convex’s published cloud limits and the current open-source backend line up on most transaction/function ceilings. The big caveats are that self-hosted limits are mostly configurable backend defaults, the documented 4 MiB single-scheduled-function argument limit is not currently enforced by the open-source backend, and the Convex-runtime action timeout changed recently.

“Documents read” below means **documents scanned**, including documents discarded by `.filter()`. Also, in a production cloud deployment the detailed developer/read-limit error is redacted to a generic `"Server Error"` at the client; the complete error and stack remain in deployment logs. ([Convex Developer Hub](https://docs.convex.dev/functions/error-handling/?utm_source=chatgpt.com))

### Core function and transaction limits

| Limit | Cloud, Sep 2026 | Error when exceeded |
|---|---:|---|
| Documents scanned/read — **query** | **32,000** | `TooManyDocumentsRead` — “Too many documents read in a single function execution…”  |
| Documents scanned/read — **mutation** | **32,000** | Same `TooManyDocumentsRead` |
| Data read — query or mutation | **16 MiB** | `TooManyBytesRead` — “Too many bytes read in a single function execution…”  |
| Documents written — **query** | **0 / unsupported** | Queries are pure reads; their context has no database writer, so this is an API/type restriction rather than the transaction-limit error. ([Convex Developer Hub](https://docs.convex.dev/api/modules/server?utm_source=chatgpt.com)) |
| Documents written — **mutation** | **16,000** | `TooManyWrites` — “Too many writes in a single function execution…”  |
| Data written — mutation | **16 MiB** | `TooManyBytesWritten`  |
| Index ranges/read-set intervals — query or mutation | **4,096** | `TooManyReads` — despite the docs calling this “index ranges read.”  |
| Query execution | **1 s user-code CPU** | `Function execution timed out (maximum duration: …)` / `UserTimeoutError`. Database-operation time is excluded from the 1-second budget. ([Convex Developer Hub](https://docs.convex.dev/production/state/limits))  |
| Mutation execution | **1 s user-code CPU** | Same timeout error. ([Convex Developer Hub](https://docs.convex.dev/production/state/limits)) |
| Action, **Convex/default runtime** | **30 minutes** | Same `Function execution timed out (maximum duration: …)` family. ([Convex Developer Hub](https://docs.convex.dev/production/state/limits))  |
| Action, **Node runtime** | **10 minutes** | `Action \`<name>\` execution timed out (maximum duration 600s)` ([Convex Developer Hub](https://docs.convex.dev/production/state/limits))  |
| Function arguments | **16 MiB** | Developer JS error: `Arguments for <function> are too large (actual: …, limit: …)` ([Convex Developer Hub](https://docs.convex.dev/production/state/limits?utm_source=chatgpt.com))  |
| **Node action** arguments | **5 MiB**, not 16 MiB | `InvalidFunctionArguments`: “Node actions arguments size is too large. The maximum allowed size is 5 MiB.” ([Convex Developer Hub](https://docs.convex.dev/production/state/limits?utm_source=chatgpt.com))  |
| Function return value | **16 MiB** | Developer JS error: `Function <function> return value is too large (actual: …, limit: …)` ([Convex Developer Hub](https://docs.convex.dev/production/state/limits))  |
| Functions scheduled by one mutation | **1,000** | `TooManyFunctionsScheduled`  |
| Total arguments of functions scheduled by one mutation | **16 MiB** | `ScheduledFunctionsArgumentsTooLarge`  |
| Arguments for one scheduled function | Cloud docs say **4 MiB** | See caveat below: current backend source explicitly marks this 4 MiB knob **“not currently enforced.”** ([Convex Developer Hub](https://docs.convex.dev/production/state/limits)) |

The official Limits page is the authoritative cloud summary for the transaction values: **16 MiB read, 16 MiB written, 32,000 documents scanned, 4,096 index ranges, and 16,000 writes** per query/mutation transaction. ([Convex Developer Hub](https://docs.convex.dev/production/state/limits)) Nested `ctx.runQuery`/`ctx.runMutation` calls from another query or mutation share the enclosing transaction budget rather than resetting it. ([Convex Developer Hub](https://docs.convex.dev/database/writing-data?utm_source=chatgpt.com))

### Index limits

For ordinary database indexes, cloud currently publishes **32 indexes per table**, **16 fields per index**, and an **index-name maximum of 64 characters**. `_creationTime` is automatically appended and counts toward the 16-field limit. ([Convex Developer Hub](https://docs.convex.dev/production/state/limits?utm_source=chatgpt.com))

The backend’s concrete validation errors include `IndexTooManyFields` for exceeding 16 fields and `TooManyIndexes` for the backend’s aggregate per-table index check.   These are **schema/deployment validation errors**, not runtime query errors.

There is one cloud-versus-source wrinkle here: the current backend defines an aggregate `MAX_INDEXES_PER_TABLE` of **64**, counting active/staged database, search, and vector indexes together, whereas the cloud product contract separately publishes **32 normal DB indexes**, **4 search indexes**, and **4 vector indexes** per table.   ([Convex Developer Hub](https://docs.convex.dev/production/state/limits)) I would therefore use **32** as the portable/cloud limit for ordinary `.index()` definitions rather than relying on the backend’s internal aggregate ceiling.

Cloud search-specific caps are also currently: full-text **4 indexes/table, 16 filter fields/index, 16 search terms, 8 query filters, 32-byte terms, 1,024 results**; vector search **4 indexes/table, 16 filter fields/index, dimensions 2–4096, 64 query filters, and 256 results**. ([Convex Developer Hub](https://docs.convex.dev/production/state/limits))

### Pagination

There is **no fixed hard maximum page size corresponding to `numItems`**. `numItems` is explicitly only an *initial* requested number; reactive pagination can return more or fewer. ([Convex Developer Hub](https://docs.convex.dev/api/interfaces/server.PaginationOptions))

`PaginationOptions` now has `maximumRowsRead` and `maximumBytesRead`. These are caller-selected page-splitting guardrails rather than additional global hard ceilings. If a page reaches them, pagination can return an incomplete/split page; the client uses `pageStatus`/`splitCursor` to split the range. Neither setting is currently enforced for search queries. ([Convex Developer Hub](https://docs.convex.dev/api/interfaces/server.PaginationOptions?utm_source=chatgpt.com))

Importantly, `.paginate()` has special handling for transaction pagination-limit failures: the backend can turn a pagination-limit condition into `pageStatus: "SplitRequired"` rather than simply exposing the transaction error.  Outside that pagination machinery, the ultimate transaction ceilings are still the 32,000-document / 16-MiB / 4,096-read-range limits above.

### Cloud vs. self-hosted

The current open-source backend gives the same **defaults** for the major limits—32,000 rows read, 16,000 user writes, 16 MiB read/write/args/results, 4,096 read-set intervals, 1,000 scheduled functions, 30-minute Convex-runtime actions, and 10-minute Node actions—but most are implemented through `env_config(...)` knobs such as `TRANSACTION_MAX_READ_SIZE_ROWS`, `TRANSACTION_MAX_NUM_USER_WRITES`, `FUNCTION_MAX_ARGS_SIZE`, `V8_ACTION_USER_TIMEOUT_SECS`, and `NODE_ACTION_USER_TIMEOUT_SECS`. ([github.com](https://github.com/get-convex/convex-backend/blob/main/crates/common/src/knobs.rs?utm_source=chatgpt.com))

That means **cloud values are the product/service contract**, while on **self-hosted deployments they are generally out-of-box defaults that an operator can override**. Those knobs are backend implementation controls rather than a promise that arbitrary higher settings are tested or supported.

The clearest actual divergence is the scheduled-argument rule: cloud documentation publishes **4 MiB per scheduled function**, while current source defines the 4 MiB knob with the comment **“This is not currently enforced.”** The backend does enforce the **16 MiB aggregate scheduled-argument size per mutation**. ([github.com](https://github.com/get-convex/convex-backend/blob/main/crates/common/src/knobs.rs?utm_source=chatgpt.com)) So on self-hosted I would not describe 4 MiB as a hard limit.

### What changed recently

- **Convex/default-runtime actions changed from 10 minutes to 30 minutes in July 2026.** The backend change increased `V8_ACTION_USER_TIMEOUT_SECS` from `600` to `1800`; Node remained at `600` seconds.  The current Limits page reflects 30m/10m. ([Convex Developer Hub](https://docs.convex.dev/production/state/limits)) Note that the separate Actions guide still says generically “Actions time out after 10 minutes,” so that page is now stale/incomplete for Convex-runtime actions. ([Convex Developer Hub](https://docs.convex.dev/functions/actions?utm_source=chatgpt.com))
- **`convex@1.32.0` added `maximumRowsRead` and `maximumBytesRead` to `PaginationOptions`.** This changed pagination control, not the global transaction ceilings. ([GitHub](https://github.com/get-convex/convex-js/blob/main/CHANGELOG.md?utm_source=chatgpt.com))
- **`convex@1.41.0` added `transactionLimits` to nested `runQuery`/`runMutation`.** Those let callers deliberately impose lower bounds on nested work; they do not increase the platform’s hard transaction limits. 
- A September 2025 backend change increased an **internal transaction cache** to track the read-size ceiling. That was an implementation/cache adjustment, not a change from the documented 16 MiB user read limit. 

So, for application design on cloud, the compact rule of thumb is **32k scanned / 16k written / 16 MiB read / 16 MiB written / 4,096 index ranges / 1s query-mutation CPU / 30m Convex action / 10m Node action / 16 MiB args+returns, except 5 MiB Node-action args / 1,000 schedules per mutation**. The exact backend error identifiers above are useful for logs and local/dev deployments, but production clients should not depend on receiving them because Convex redacts server errors there. ([Convex Developer Hub](https://docs.convex.dev/functions/error-handling/?utm_source=chatgpt.com))

---

If you want, I can:

- Explain key differences between Convex cloud and self-hosted limits
- Summarize recent Convex limit changes and their impact
- Detail error messages triggered when Convex limits are exceeded
