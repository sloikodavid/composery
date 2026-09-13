# Summarize Convex 145 Conventions

Source: https://chatgpt.com/share/6aa68548-def0-83eb-9178-405ff43c288e

---

**User**

Give me Convex 1.45 backend code conventions as of September 2026,
  from official guidelines (docs.convex.dev, the Convex AI rules /
  agent skills, and the Stack blog).
  1. Function syntax: args + returns validators on every function?
  query / mutation / action vs internal*. The model/ helper-function
  pattern vs thin wrappers. When to use `"use node"`, and how to
  split node and default-runtime files.
  2. Schema: indexes (naming, compound indexes, avoiding .filter()),
  `v.id`, optional fields vs unions, timestamps, pagination, staged
  indexes, and schema validation settings.
  3. Auth: `ctx.auth.getUserIdentity()`, `auth.config.ts` with Clerk
  (applicationID "convex"), and custom function wrappers
  (convex-helpers customQuery) for access control.
  4. Scheduling and long-running work: scheduler vs crons vs the
  @convex-dev/workflow, workpool and action-retrier components.
  Current component list and maturity.
  5. HTTP actions and webhooks (Stripe, Clerk via svix /
  @clerk/backend verifyWebhook): raw body handling and idempotency.
  6. Error handling: ConvexError with data vs thrown Error, and how
  clients see each.
  7. Linting without ESLint: which @convex-dev/eslint-plugin rules
  matter, and how to enforce them (Biome, TS types, or code review).
  8. Migrations (@convex-dev/migrations) and a safe workflow for
  changing the schema on prod data.

---

**ChatGPT**

I’ll cross-check the current Convex docs, the official AI rules/agent guidance, and Convex’s Stack posts, then reconcile any differences into one set of 1.45-era conventions. I’ll also flag places where the docs describe a capability but don’t prescribe a single “best practice.”

---

**ChatGPT**

Two important conventions are already clear from the current docs: object-form functions with both `args` and `returns` are now the recommended baseline, and Convex explicitly recommends pushing most business logic into plain TypeScript helpers under something like `convex/model`, leaving registered functions thin.

---

**ChatGPT**

One nuance worth preserving rather than flattening: Convex’s validation page still says internal-function validation is optional, while the current API reference says to put `args` and `returns` on **all** functions. For a 1.45 house style, I’d follow the stricter API/AI convention; it gives consistent runtime contracts and makes internal refactors safer.

---

**ChatGPT**

As of **13 September 2026**, `convex@1.45.0` is the current npm release. One caveat when reconciling the sources: a public snapshot of Convex’s generated AI `guidelines.md` still identifies itself as targeting `^1.44.0`, while the live 1.45 API docs are newer. I would therefore treat the **installed 1.45 types/API docs as authoritative**, then use current AI rules/skills and Stack posts for architectural conventions. Convex itself now recommends installing/updating these rules with `npx convex ai-files install|update`. ([npm](https://www.npmjs.com/package/convex?activeTab=versions&utm_source=chatgpt.com))

Here is the backend convention set I would standardize on for a new Convex 1.45 codebase.

## 1. Functions: syntax, visibility, helpers, Node runtime

**Use object syntax, and put `args` and `returns` validators on every registered Convex function.** The current API reference is explicit: always include both; use `returns: v.null()` when there is no result. The older/general validation page is slightly looser and says validation of internal functions is optional. For a 1.45 house style, I would follow the stricter API/AI convention. ([Convex](https://docs.convex.dev/functions/validation?utm_source=chatgpt.com))

```ts
export const create = mutation({
  args: {
    name: v.string(),
    projectId: v.id("projects"),
  },
  returns: v.id("items"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("items", {
      name: args.name,
      projectId: args.projectId,
    });
  },
});

export const touch = internalMutation({
  args: { id: v.id("items") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.patch("items", id, { updatedAt: Date.now() });
    return null;
  },
});
```

Use the function types according to their actual semantics: **query** = deterministic reads, cached/reactive; **mutation** = transactional reads/writes; **action** = network/external side effects and no direct `ctx.db`. Use `internalQuery`, `internalMutation`, and `internalAction` whenever a function exists only for backend orchestration, scheduling, actions, HTTP actions, or crons. Convex specifically recommends scheduling and `ctx.run*` against `internal.*`, not `api.*`. ([Convex](https://docs.convex.dev/functions/overview?utm_source=chatgpt.com))

The stronger architectural convention is:

> **Registered Convex functions are API/transaction boundaries, not your main abstraction unit.**

Convex's current Best Practices says most business logic should live in ordinary TypeScript helpers, typically under something like `convex/model/`, with queries/mutations/actions acting as thin wrappers around them. This also avoids unnecessary `ctx.runQuery`/`ctx.runMutation` calls. Inside an action, each `runQuery`/`runMutation` is a separate transaction, so batch logically related reads/writes into one call. `runAction` should normally only exist when crossing runtimes; for same-runtime reuse, call a TypeScript helper directly. ([Convex](https://docs.convex.dev/understanding/best-practices?utm_source=chatgpt.com))

A good layout is roughly:

```text
convex/
  schema.ts
  auth.config.ts
  projects.ts           # thin public/internal wrappers
  billing.ts
  billing.node.ts       # Node-only actions
  model/
    projects.ts         # business/data helpers
    billing.ts          # runtime-neutral helpers
```

For `"use node"`: **default to the Convex runtime**. It has no cold starts and supports `fetch` and most web-compatible npm libraries. Add `"use node"` only when a dependency genuinely needs unsupported Node APIs. A `"use node"` module may contain actions/internal actions, but not queries or mutations; default-runtime modules may not import Node-runtime modules. Node-specific helper modules need `"use node"` too if their transitive imports require Node APIs. ([Convex](https://docs.convex.dev/functions/runtimes?utm_source=chatgpt.com))

So this is good:

```ts
// billing.node.ts
"use node";

export const syncStripe = internalAction({
  args: { customerId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Node-only package
    ...
    await ctx.runMutation(internal.billing.persistSync, ...);
    return null;
  },
});
```

Don't put `"use node"` on a file merely because it's an action.

---

## 2. Schema: IDs, indexes, optionals, timestamps, pagination

### Indexes

Name an index after **all of its indexed fields**. The 1.45 API explicitly recommends this. Docs examples use forms such as `by_channel_user`; AI guidance has also used `by_field1_and_field2`. The important convention is not the `"and"`—it is that the complete field sequence is visible in the name. ([Convex](https://docs.convex.dev/api/modules/server?utm_source=chatgpt.com))

I'd standardize on:

```ts
.index("by_projectId_status", ["projectId", "status"])
.index("by_userId_createdAt", ["userId", "createdAt"])
```

Compound index **field order is part of the query design**. Equality conditions start at the leftmost field; after zero or more equality constraints you can range over the next field. You cannot skip a leading field. `_creationTime` is automatically appended as the final index field. ([Convex](https://docs.convex.dev/database/reading-data/indexes/?utm_source=chatgpt.com))

Treat `.filter()` as a **residual predicate**, not as your primary lookup mechanism. Convex's linter deliberately warns on it because filtering does not reduce the rows scanned. A defensible use is:

```ts
ctx.db
  .query("messages")
  .withIndex("by_channelId", q => q.eq("channelId", channelId))
  .filter(q => q.neq(q.field("authorId"), currentUserId))
  .take(50);
```

Here the index bounds the candidate set first. For an unbounded or potentially large selection, make another index instead. ([Convex](https://docs.convex.dev/database/reading-data/filters?utm_source=chatgpt.com))

For large production tables, use **staged indexes**. Deploy with `staged: true`, allow the asynchronous backfill to finish, then deploy again without `staged` and only then ship code that queries it. A staged index cannot be queried. ([Convex](https://docs.convex.dev/database/reading-data/indexes/?utm_source=chatgpt.com))

### IDs

Use `v.id("table")`, not `v.string()`, for foreign keys and ID function parameters. And with database operations, use the explicit-table form:

```ts
await ctx.db.get("users", userId);
await ctx.db.patch("users", userId, patch);
await ctx.db.delete("users", userId);
```

Convex recommends explicit table names because they provide an additional table-ID safety check and are the forward-looking API. ([Convex](https://docs.convex.dev/database/schemas?utm_source=chatgpt.com))

### `v.optional` versus unions

Use `v.optional(T)` when the semantic state is **“this property may be absent.”** Use `v.union(...)` when the stored value genuinely has multiple valid shapes/types, especially discriminated unions. During migrations, unions are also the standard way to temporarily permit old and new representations. ([Convex](https://docs.convex.dev/database/schemas?utm_source=chatgpt.com))

```ts
// absent is meaningful
nickname: v.optional(v.string()),

// actual state machine / variants
status: v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("disabled"),
),
```

Don't use optional fields indefinitely just to make schema changes easy; Stack's current migration guidance explicitly recommends narrowing them again after the backfill.

### Timestamps

You already get `_creationTime`, in **milliseconds since Unix epoch**, on every document. Don't add a duplicate `createdAt` unless its semantics differ. Store application points-in-time as `v.number()` milliseconds; for calendar dates/local clock times, Convex recommends strings plus an IANA timezone where relevant. ([Convex](https://docs.convex.dev/database/types?utm_source=chatgpt.com))

For mutable records, an explicit:

```ts
updatedAt: v.number()
```

is reasonable if you need modification time.

Avoid `Date.now()` inside reactive queries for “what is current now?” logic. Convex specifically warns that queries aren't re-run merely because wall time moved; use scheduled state transitions or pass a coarse timestamp as an argument instead. ([Convex](https://docs.convex.dev/understanding/best-practices?utm_source=chatgpt.com))

There is also now `ctx.db.vars.commitTs` / `v.commitTs()` when you specifically need **transaction commit ordering**; that is nanoseconds/`bigint` semantics and is not a replacement for normal user-facing millisecond timestamps. ([Convex](https://docs.convex.dev/database/advanced/commit-timestamp?utm_source=chatgpt.com))

### Pagination and bounded reads

For collections that can grow without bound, use `.paginate()` with `paginationOptsValidator`; otherwise use `.take(n)`, `.first()`, or `.unique()`. Don't normalize on unbounded `.collect()` merely because a table is small today. An index without a range should likewise end in a bounded consumer such as `take`, `paginate`, `first`, or `unique`. ([Convex](https://docs.convex.dev/database/reading-data/indexes/?utm_source=chatgpt.com))

### Schema settings

For production code, leave both defaults enabled:

```ts
export default defineSchema(
  { ... },
  {
    schemaValidation: true,
    strictTableNameTypes: true,
  },
);
```

They're already `true` by default. `schemaValidation: false` removes runtime checking of both existing and future documents; `strictTableNameTypes: false` lets TypeScript access undeclared tables as `any`. Those are prototyping escape hatches, not migration strategies. ([Convex](https://docs.convex.dev/database/schemas?utm_source=chatgpt.com))

---

## 3. Authentication and authorization

The baseline server check remains:

```ts
const identity = await ctx.auth.getUserIdentity();

if (identity === null) {
  throw new ConvexError({ code: "UNAUTHENTICATED" });
}
```

Do this **inside Convex**, even if Clerk/Next middleware or frontend guards already authenticate the user. Public Convex functions are callable APIs. Never authorize a request merely from a client-supplied `userId`, email, role, etc. Resolve the caller from `ctx.auth` and then check ownership/membership for the actual resource being accessed. ([Convex](https://docs.convex.dev/auth/functions-auth?utm_source=chatgpt.com))

For Clerk, the current official `convex/auth.config.ts` remains:

```ts
import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
```

Use the appropriate issuer-domain environment variable on both development and production deployments. ([Convex](https://docs.convex.dev/auth/clerk?utm_source=chatgpt.com))

For your database user record, `identity.tokenIdentifier` is the provider-independent Convex identity key commonly used in the official example; it combines issuer/subject to remain unique across providers. ([Convex](https://docs.convex.dev/auth/functions-auth?utm_source=chatgpt.com))

For a nontrivial backend, I do recommend `convex-helpers/server/customFunctions` wrappers:

```ts
import {
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";

export const authedQuery = customQuery(
  query,
  customCtx(async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ code: "UNAUTHENTICATED" });
    }

    const user = await getUserForIdentity(ctx, identity);
    return { user };
  }),
);
```

The official `convex-helpers` package specifically supports pre-function auth logic, context augmentation, and even wrapped/RLS database access. ([GitHub](https://github.com/get-convex/convex-helpers/blob/main/packages/convex-helpers/server/customFunctions.ts?utm_source=chatgpt.com))

Use wrappers to enforce **baseline policy**—authenticated user, admin user, organisation member—and inject useful context. Still perform **resource-level authorization** close to the data operation:

```ts
const project = await loadProject(ctx, args.projectId);
assertCanEditProject(ctx.user, project);
```

That gives you “secure by default” wrappers without hiding critical object-level authorization.

---

## 4. Scheduling and long-running work

My decision tree for 1.45 would be:

| Need | Use |
|---|---|
| Run one function later | `ctx.scheduler.runAfter/runAt` |
| Fixed recurring schedule in source control | built-in `convex/crons.ts` |
| Dynamically registered recurring schedules | `@convex-dev/crons` component |
| Throttle/queue/prioritize async jobs | `@convex-dev/workpool` |
| Multi-step durable orchestration | `@convex-dev/workflow` |
| Only retry an idempotent action | `@convex-dev/action-retrier` |

Convex itself says built-in scheduled functions and crons are suitable for simpler apps; Workpool, Workflow, and the Crons component are the higher-level choices when you need stronger operational behavior. ([Convex](https://docs.convex.dev/scheduling/overview?utm_source=chatgpt.com))

The built-in scheduler guarantees are important:

- scheduled **mutations** execute exactly once and transient Convex failures are retried;
- scheduled **actions** execute at most once and are **not** automatically retried.

Scheduling from a mutation is atomic with the mutation. Scheduling from an action is not. Also, auth context does not automatically propagate to a scheduled function. ([Convex](https://docs.convex.dev/scheduling/scheduled-functions?utm_source=chatgpt.com))

`@convex-dev/workpool` is for concurrency limits, queues/priorities, configurable retries of idempotent actions, and completion callbacks. `@convex-dev/workflow` builds on Workpool for durable multi-step flows, persisted execution history, delays, branching, parallel steps, retries and workflows lasting months. `@convex-dev/action-retrier` is deliberately narrower: retry an action with exponential backoff. Convex's agent/workflow docs explicitly describe Workpool and Workflow as the more robust choices when you need more than retrying. ([Convex](https://www.convex.dev/components/workpool?utm_source=chatgpt.com))

On maturity: the scheduler and static crons are **core platform primitives**. Workflow, Workpool, Crons, Action Retrier and Migrations are **official Convex components**, maintained/listed by Convex, but they're independently versioned packages rather than part of `convex@1.45`. For example Workflow is currently `0.4.6`, Action Retrier `0.3.1`, and Migrations `0.3.6`. I would use them in production, but pin their versions rather than treating their APIs as having the same compatibility surface as the core 1.x SDK. ([Convex](https://docs.convex.dev/components?utm_source=chatgpt.com))

---

## 5. HTTP actions and webhooks

`httpAction` is different from normal Convex functions: it consumes a standard Fetch `Request` and returns a `Response`; **there are no Convex argument validators**, so request parsing and validation are your responsibility. It has an action context and accesses DB state through `runQuery`/`runMutation`. ([Convex](https://docs.convex.dev/functions/http-actions?utm_source=chatgpt.com))

For signed webhooks, **do not parse JSON before signature verification** if the verifier expects the raw body.

For manual Stripe verification:

```ts
const body = await request.text();
const signature = request.headers.get("stripe-signature")!;

const event = stripe.webhooks.constructEvent(
  body,
  signature,
  process.env.STRIPE_WEBHOOK_SECRET!,
);
```

Stripe explicitly requires the original UTF-8 request body with no mutations; JSON parsing/re-serialization can invalidate the signature. ([Stripe Docs](https://docs.stripe.com/webhooks/signature?lang=node&utm_source=chatgpt.com))

For new Stripe integrations, Convex's current component guidance is even simpler: use `@convex-dev/stripe`'s `registerRoutes`, which handles signature verification and component state for you, rather than hand-rolling the webhook infrastructure. ([Stack by Convex](https://stack.convex.dev/how-to-use-convex-stripe-component?utm_source=chatgpt.com))

For Clerk, two current patterns exist:

- Convex's database-auth guide still demonstrates direct Svix verification.
- Clerk's current backend API now exposes `verifyWebhook(request)` from `@clerk/backend/webhooks`, accepting the Fetch `Request` directly.

With `verifyWebhook`, hand it the untouched request first; don't consume `request.json()` or `request.text()` before it. ([Clerk](https://clerk.com/docs/reference/backend/verify-webhook?utm_source=chatgpt.com))

For **idempotency**, assume every webhook can be delivered more than once. Signature verification proves authenticity, not uniqueness. A good Convex pattern is:

```text
HTTP action
  ↓ verify signature
single internal mutation
  ↓ lookup provider event/delivery ID
  ├─ already processed → no-op
  └─ new → insert dedupe row + atomically update local state
                         ↓
              optionally schedule workflow/action
```

Use e.g. Stripe's `event.id` or the webhook provider's delivery/message ID as a dedupe key, backed by an index. Make the mutation itself atomic. For outbound Stripe requests that might be retried, use Stripe idempotency keys as well. Convex's durability guidance stresses that retried side effects have to be designed idempotently. ([Stack by Convex](https://stack.convex.dev/durable-workflows-and-strong-guarantees?utm_source=chatgpt.com))

---

## 6. Error handling

Use **`ConvexError` for expected application/domain failures that a client is allowed to understand**:

```ts
throw new ConvexError({
  code: "PROJECT_FORBIDDEN",
  message: "You do not have access to this project",
});
```

`ConvexError.data` can be any supported Convex value and is delivered to the client, where it remains a `ConvexError` with `.data`. Because this survives production redaction, never put secrets or internal details in it. ([Convex](https://docs.convex.dev/functions/error-handling/application-errors?utm_source=chatgpt.com))

Use ordinary `Error` for bugs, violated invariants, impossible states, unexpected provider failures, etc.:

```ts
throw new Error(`Missing invariant: invoice has no customer`);
```

In development, ordinary server errors reach the client with their message and server stack. In **production**, Convex redacts ordinary server errors to a generic `"Server Error"` plus function name/no stack; full details remain in server logs. `ConvexError.data` remains visible. ([Convex](https://docs.convex.dev/functions/error-handling/?utm_source=chatgpt.com))

A useful convention is:

```text
Normal business branch     → discriminated return value, when convenient
Expected exceptional case  → ConvexError({ code, ... })
Bug/invariant/system fault  → Error
```

Convex explicitly supports either discriminated return values or `ConvexError` for expected application failures. A thrown mutation also rolls the entire mutation back. ([Convex](https://docs.convex.dev/functions/error-handling/application-errors?utm_source=chatgpt.com))

---

## 7. Linting if you're not using ESLint

The currently **recommended** `@convex-dev/eslint-plugin` rules are:

```text
no-old-registered-function-syntax
require-argument-validators
explicit-table-ids
no-filter-in-query
no-top-of-hour-crons
no-schema-import-cycle
```

There are also non-recommended/extra rules such as the currently experimental `import-wrong-runtime` and the type-aware `no-collect-in-query`. ([Convex](https://docs.convex.dev/eslint?utm_source=chatgpt.com))

For backend correctness, I would treat these as the important semantic checks even in a no-ESLint repo:

1. object registered-function syntax;
2. `args` **and** `returns` validators;
3. explicit table name for `get/patch/replace/delete`;
4. index-before-filter;
5. no accidental default-runtime → `"use node"` imports;
6. bounded queries (`take`/`paginate`) instead of potentially unbounded `collect`;
7. no schema import cycles.

Note that the plugin currently has `require-argument-validators` but **not an equivalent recommended `require-return-validators` rule**. Return validators therefore need a code-review/CI convention even though the current API docs tell you to use them. ([Convex](https://docs.convex.dev/eslint?utm_source=chatgpt.com))

If you are on Biome, don't assume it can directly execute `@convex-dev/eslint-plugin`. Biome now supports its own **GritQL lint plugins**, so you can reproduce simple syntactic policies, but that is a different plugin mechanism. Some Convex rules—especially type-aware explicit IDs/import relationships—are more than simple regex-style checks. ([Biome](https://biomejs.dev/linter/plugins/?utm_source=chatgpt.com))

So for a Biome-first repo I'd run CI approximately as:

```bash
biome check .
tsc --noEmit
npx convex dev --once
```

and make the Convex-specific rules above part of review/agent instructions. `tsc` is necessary but **not sufficient**: valid TypeScript can still omit validators, use `.filter()`, or perform an unbounded `.collect()`.

For legacy ID syntax specifically, Convex also provides an autofix/codemod path rather than requiring permanent ESLint adoption. ([Convex](https://docs.convex.dev/eslint?utm_source=chatgpt.com))

---

## 8. Production schema migrations

The canonical 2026 rule is **widen → migrate → narrow**. Both the current Stack guidance and the official migration agent skill use this exact model. ([Stack by Convex](https://stack.convex.dev/the-secret-to-migrations?utm_source=chatgpt.com))

For example, suppose:

```ts
name: v.string()
```

is becoming:

```ts
displayName: v.string()
```

Don't deploy the final schema directly against existing production rows. Instead:

**Deploy 1 — widen compatibility**

```ts
name: v.optional(v.string()),
displayName: v.optional(v.string()),
```

Update reads so both formats work, while **all new writes immediately write the new representation**.

Then define an idempotent `@convex-dev/migrations` migration:

```ts
export const backfillDisplayName = migrations.define({
  table: "users",
  migrateOne: async (ctx, user) => {
    if (user.displayName !== undefined) return;

    await ctx.db.patch("users", user._id, {
      displayName: user.name ?? "Unknown",
    });
  },
});
```

The component batches online, persists progress, resumes after failures, supports `dryRun`, status queries, restricted index ranges, and avoids starting duplicate workers. ([GitHub](https://github.com/get-convex/migrations?utm_source=chatgpt.com))

Before touching production:

```bash
npx convex run migrations:backfillDisplayName \
  --prod \
  '{"dryRun":true}'
```

Then run the actual migration and watch status. Once you've verified that **every document** satisfies the final form, make Deploy 2:

```ts
displayName: v.string()
```

remove `name`, remove compatibility branches, and deploy. Leaving `schemaValidation: true` is useful here: the final schema push acts as a safety gate and will fail if you've missed old documents. ([GitHub](https://github.com/get-convex/migrations?utm_source=chatgpt.com))

For a type change, temporarily use a union:

```ts
amount: v.union(v.string(), v.number())
```

migrate old strings to numbers, then narrow back to:

```ts
amount: v.number()
```

For a field deletion, first make it optional, migrate it away with `{ field: undefined }`, verify, and only then remove it from the schema.

If a migration has already partially modified production data and something goes wrong, Stack's recommendation is generally to **roll forward**, because reverting application code does not magically revert the already-migrated subset. ([Stack by Convex](https://stack.convex.dev/the-secret-to-migrations?utm_source=chatgpt.com))

---

### The compact 1.45 house standard

If I were putting this into an engineering `AGENTS.md`, the core policy would be: **thin public/internal Convex wrappers; plain TypeScript model helpers; `args` + `returns` everywhere; internal refs for backend orchestration; default runtime unless Node is genuinely necessary; every growing lookup begins from an index and ends bounded/paginated; all protected public functions derive identity from `ctx.auth`; external side effects are idempotent; expected client-visible failures use structured `ConvexError`; and every breaking schema change is a two-deploy widen/migrate/narrow rollout.**

That is the closest single set of conventions I can derive from the current 1.45 API/docs, Convex's AI rules/skills, components, and Stack guidance rather than merely copying one of those sources. ([Convex](https://docs.convex.dev/understanding/best-practices?utm_source=chatgpt.com))
