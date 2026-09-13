# Define Convex Data Loading Policy

Source: https://chatgpt.com/share/6aa6a1a9-57dc-83ed-9098-5010e5f3cfa8

---

**User**

Context (September 2026). A single-package web app (not a
  monorepo):
  - Bun 1.4.2 (package manager, scripts, `bun test`), Node 24
  runtime for Next.js
  - Next.js 16.3.5 App Router in `src/`, React 19.3, React Compiler
  on, typedRoutes on. `cacheComponents` and `partialPrefetching` are
  currently OFF (undecided).
  - Convex 1.45.0 (cloud deployments), root `convex/` directory
  - Clerk (@clerk/nextjs 7.9.2) using the HOSTED Account Portal for
  sign-in, sign-up and the user profile. No Clerk UI components in
  our app. Clerk FREE plan (no passkeys, no MFA, session length
  fixed at 7 days). `clerkMiddleware()` runs in `src/proxy.ts`;
  `ClerkProvider` + Convex's `ConvexProviderWithClerk` wrap the root
  layout. Clerk's native Convex integration (session token `aud:
  "convex"`).
  - Base UI + Tailwind 4, Biome, TypeScript 7. Static CSP in
  next.config.ts (no nonces). Deploying to Vercel later.
  - Product shape: NO pricing page and no separate dashboard. The
  home route `/` is both the public marketing funnel (SEO matters)
  and the signed-in app.
  - Hard UI rules: no avoidable layout shift (CLS) in
  loading/empty/error/success states, no animated skeletons, no
  page-level spinners, no decorative motion.

  Rules for your answer:
  - Ground every claim in official docs, source code, changelogs, or
  GitHub issues for these exact versions, with links. Mark anything
  you could not verify for these versions as UNVERIFIED.
  - Separate what the frameworks guarantee from what is your
  recommendation.
  - End with: (1) a recommended policy stated as short rules we can
  adopt, (2) concrete code shapes for Next 16.3 + Convex 1.45 +
  Clerk 7.9, (3) the trade-offs you rejected and why, (4) open
  risks.

  Define our data-loading policy for Convex 1.45 in Next.js 16.3
  with Clerk auth.
  1. When to use `useQuery` (client-only), `preloadQuery` +
  `usePreloadedQuery` (server render then live), and `fetchQuery`
  (server snapshot). Include how each passes the Clerk token
  server-side (`(await auth()).getToken()` with the native Convex
  integration), consistency between several server calls, and
  request waterfalls.
  2. Does `preloadQuery` in a Server Component make the route
  dynamic? How does it interact with `cacheComponents`, `"use
  cache"`, Suspense streaming, and Partial Prerendering? Is there
  any safe way to cache authenticated Convex data in Next, or should
  it never be?
  3. For reactive app UIs, is server-preloading worth it versus
  client `useQuery` with a size-stable placeholder? Measure or cite
  trade-offs: time to first meaningful paint, hydration cost,
  duplicate fetch (HTTP preload then WebSocket subscribe).
  4. Mutations: call Convex mutations directly from the client
  (`useMutation`, optimistic updates) versus Next Server Actions
  calling `fetchMutation`. When is each right?
  5. Error and empty states: how Convex query errors surface in RSC
  vs client, error boundaries in App Router, and patterns that keep
  geometry stable.
  6. Give a short policy ("default to X; use Y only when Z") and the
  helper modules we should write once (e.g. a server-only token
  helper).

---

**ChatGPT**

I’ll treat this as a version-pinned architecture review, not a generic “best practices” answer. I’ll verify behavior against the exact Next 16.3.5 / Convex 1.45.0 / Clerk 7.9.2 surfaces where possible, then separate framework guarantees from policy recommendations and flag anything version-specific I can’t prove as **UNVERIFIED**.

---

**ChatGPT**

Two important facts are already clear from the pinned Convex surface: `preloadQuery` is explicitly implemented on top of `fetchQuery`, and Convex documents both as using a stateless `ConvexHttpClient`; separate server calls therefore do **not** get the same snapshot guarantee that the live `ConvexReactClient` gives. Convex’s own guidance is to avoid multiple `preloadQuery` calls on one page when inconsistent cross-query state would be visible.

---

**ChatGPT**

The caching answer is also sharper than “auth makes everything dynamic.” With your flags **off**, Convex explicitly says `preloadQuery` uses `cache: "no-store"` and therefore its Server Component is not statically renderable; Clerk’s server `auth()` is request-time too. If you later enable Cache Components, Next 16.3.5 can preserve a prerendered public shell **around** that personalized subtree by putting the uncached/authenticated work behind `<Suspense>`—you do not need, and generally should not want, to cache the user’s Convex result to get PPR/streaming.

---

**ChatGPT**

## Bottom line

For this app, I would make **client `useQuery` the default for authenticated, reactive application data**. Use a **size-stable app frame** while Convex/Clerk becomes ready. Use **one `preloadQuery` for one composite above-the-fold query** only when real personalized data on the server-rendered first view is materially valuable and you have measured that it beats the client path. Reserve **`fetchQuery` for genuinely server-owned, non-reactive snapshots**.

That recommendation is unusually strong for your `/` because, with `cacheComponents: false`, both Clerk `auth()` and authenticated `preloadQuery` turn the route into request-time rendering. Convex explicitly gives `preloadQuery` a `cache: "no-store"` policy; Clerk documents `auth()` as opting the route into dynamic rendering. ([Convex](https://docs.convex.dev/client/react/nextjs/server-rendering))

Version check: the current Convex package is **1.45.0**, Clerk's current `@clerk/nextjs` package is **7.9.2**, and the Next docs used below identify the current version as **16.3.5**. Convex's Next.js SSR docs are currently marked **beta**. ([npm](https://www.npmjs.com/package/convex?activeTab=versions&utm_source=chatgpt.com))

One verification caveat: Convex and Clerk's web docs are current documentation rather than immutable docs snapshots labeled specifically `1.45.0`/`7.9.2`. Because those are the current published package versions today, I treat documented public API behavior as applicable; where behavior would require proving a particular internal implementation in an immutable 1.45.0 source tag, I mark it **UNVERIFIED**.

---

# 1. `useQuery` vs `preloadQuery` vs `fetchQuery`

| | `useQuery` | `preloadQuery` → `usePreloadedQuery` | `fetchQuery` |
|---|---|---|---|
| First query happens | Browser | Next server | Next server |
| Initial UI | Your placeholder until first result | Server-fetched result | Server-rendered result |
| Reactive afterward | Yes | Yes | No |
| Convex transport | `ConvexReactClient`, WebSocket | Server HTTP, then reactive browser client | Server HTTP |
| Server Clerk token | None | `{ token }` | `{ token }` |
| Multiple-query consistency | Convex guarantees coordinated client view | No cross-call snapshot guarantee | No cross-call snapshot guarantee |
| Default use here | **Yes** | Selectively | Rarely |

### `useQuery`: default interactive-app path

**Framework guarantee.** `useQuery` initially returns `undefined`, creates a Convex subscription, and subsequently rerenders as the underlying data changes. Convex explicitly guarantees that multiple React query subscriptions render a consistent view based on one database state. The React client communicates over a WebSocket. ([Convex](https://docs.convex.dev/client/react/overview?utm_source=chatgpt.com))

With Clerk, keep authenticated queries below Convex's `<Authenticated>` boundary. Clerk's current Convex integration specifically warns that auth-required queries can otherwise run before authentication finishes; its native integration pre-maps the `aud` claim Convex requires. ([Clerk](https://clerk.com/docs/guides/development/integrations/databases/convex?utm_source=chatgpt.com))

**Recommendation.** Make this your normal signed-in UI:

```tsx
"use client";

import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useQuery,
} from "convex/react";
import { api } from "../../convex/_generated/api";

export function HomeApp() {
  return (
    <>
      <AuthLoading>
        <HomeFrame state="loading" />
      </AuthLoading>

      <Unauthenticated>
        <HomeFrame state="signed-out" />
      </Unauthenticated>

      <Authenticated>
        <HomeLive />
      </Authenticated>
    </>
  );
}

function HomeLive() {
  const data = useQuery(api.home.summary);

  if (data === undefined) {
    return <HomeFrame state="loading" />;
  }

  if (data.items.length === 0) {
    return <HomeFrame state="empty" />;
  }

  return <HomeFrame state="ready" data={data} />;
}
```

Convex specifically documents `undefined` as the initial loading sentinel and says that, once a query has loaded, it does not return to `undefined`; represent true emptiness using your domain result (`[]`, `null`, etc.), not the loading sentinel. ([Convex](https://docs.convex.dev/understanding/best-practices/other-recommendations?utm_source=chatgpt.com))

---

### `preloadQuery` + `usePreloadedQuery`: server first, then live

**Framework guarantee.** Convex documents this pair specifically for “server rendered initial result, reactive thereafter”: `preloadQuery` runs in the Server Component and returns an opaque `Preloaded` object; the Client Component passes it to `usePreloadedQuery`, which initially returns that server-fetched result and remains reactive. ([Convex](https://docs.convex.dev/client/react/nextjs/server-rendering))

Authenticated form:

```tsx
// Server Component
import { preloadQuery } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import { requireConvexToken } from "@/lib/server/convex-auth";
import { HomePreloadedClient } from "./home-preloaded-client";

export async function HomePreloaded() {
  const token = await requireConvexToken();

  const preloaded = await preloadQuery(
    api.home.summary,
    {},
    { token },
  );

  return <HomePreloadedClient preloaded={preloaded} />;
}
```

```tsx
// home-preloaded-client.tsx
"use client";

import {
  type Preloaded,
  usePreloadedQuery,
} from "convex/react";
import { api } from "../../convex/_generated/api";

export function HomePreloadedClient({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.home.summary>;
}) {
  const data = usePreloadedQuery(preloaded);
  return <HomeFrame state="ready" data={data} />;
}
```

**Recommendation.** Do this only for a *small, first-screen query for which displaying a placeholder genuinely degrades the first meaningful view*. Do not automatically preload every query on a page.

---

### `fetchQuery`: server snapshot

**Framework guarantee.** Convex describes `fetchQuery` as the way to load Convex data directly into a Server Component, and explicitly describes that data as **non-reactive**. ([Convex](https://docs.convex.dev/client/react/nextjs/server-rendering))

```tsx
import { fetchQuery } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import { requireConvexToken } from "@/lib/server/convex-auth";

export async function ServerOnlySummary() {
  const token = await requireConvexToken();

  const data = await fetchQuery(
    api.reports.snapshot,
    {},
    { token },
  );

  return <ReportSummary data={data} />;
}
```

**Recommendation.** Appropriate examples are server-rendered exports, metadata decisions where live updates are irrelevant, server-only branching, emails/print views, or a Server Action that needs to read state. It is the wrong primitive for the normal live app UI because it intentionally discards Convex's subscription model.

---

## Server-side Clerk token

Convex's own Next.js/Clerk example is exactly:

```ts
import { auth } from "@clerk/nextjs/server";

const token = (await (await auth()).getToken()) ?? undefined;
```

and the token goes in the third `preloadQuery`/`fetchQuery` options argument. With Clerk's native Convex integration, the required default audience is already mapped, so you do not need an old-style named JWT template. ([Convex](https://docs.convex.dev/client/react/nextjs/server-rendering))

I would centralize and request-dedupe that:

```ts
// src/lib/server/convex-auth.ts
import "server-only";

import { auth } from "@clerk/nextjs/server";
import { cache } from "react";

export const getConvexToken = cache(async () => {
  return (await (await auth()).getToken()) ?? undefined;
});

export async function requireConvexToken(): Promise<string> {
  const token = await getConvexToken();

  if (!token) {
    throw new Error("Authentication required");
  }

  return token;
}
```

Next 16 documents `React.cache` as **request-scoped memoization**, not cross-request caching, so this is a good kind of caching: it prevents duplicate token work during a render without storing one user's auth state for another request. ([Next.js](https://nextjs.org/docs/app/getting-started/fetching-data?utm_source=chatgpt.com))

---

## Several server calls: consistency and waterfalls

This distinction matters a lot.

**Convex guarantee:** every database read *inside one query invocation* is at one logical timestamp. Separately, `preloadQuery` and `fetchQuery` use the stateless `ConvexHTTPClient`; Convex explicitly says separate preloads are not guaranteed to observe the same database state and advises against multiple `preloadQuery`s on a page. ([Convex](https://docs.convex.dev/functions/query-functions?utm_source=chatgpt.com))

Therefore, for:

```text
current user
notifications count
workspace
recent documents
```

if inconsistent combinations would be visible, don't make four preloads. Make:

```ts
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    // All DB reads in this query share one Convex snapshot.
    const user = /* ... */;
    const workspace = /* ... */;
    const recentItems = /* ... */;
    const notificationCount = /* ... */;

    return {
      user,
      workspace,
      recentItems,
      notificationCount,
    };
  },
});
```

For genuinely independent server calls, resolve the token once and start them together:

```ts
const token = await requireConvexToken();

const [a, b] = await Promise.all([
  fetchQuery(api.a.get, {}, { token }),
  fetchQuery(api.b.get, {}, { token }),
]);
```

That removes your own sequential `await` waterfall, but **does not create a shared Convex snapshot**. Next likewise recommends parallel initiation for independent data operations. ([Next.js](https://nextjs.org/docs/app/getting-started/fetching-data?utm_source=chatgpt.com))

---

# 2. Dynamic rendering, Cache Components, `"use cache"`, Suspense and PPR

## With your current flags: `cacheComponents: false`

Yes: an authenticated `preloadQuery` in `/` makes this route effectively dynamic in your current setup.

There are **two independent reasons**:

1. Convex says `preloadQuery` uses `cache: "no-store"` and therefore a Server Component using it is not eligible for static rendering. ([Convex](https://docs.convex.dev/client/react/nextjs/server-rendering))
2. Clerk says `auth()` is a request-time dynamic API and opts the route into dynamic rendering. ([Clerk](https://clerk.com/docs/guides/development/rendering-modes?utm_source=chatgpt.com))

Next 16.3.5's “previous caching model” is explicitly the model applicable when `cacheComponents` is disabled; the default `dynamic = "auto"` allows uncached/request-time work to opt the route into dynamic behavior. ([Next.js](https://nextjs.org/docs/app/guides/caching))

A `<Suspense>` boundary is still useful for **streaming** and limiting which part waits, but with Cache Components off it does not magically turn that `/` route back into a build-time public shell.

### Recommendation

For your present configuration, **do not introduce `auth()`/`preloadQuery` into `/` merely to shave off the client loading state**. You would trade away a particularly valuable property of a public marketing/SEO route.

---

## If you enable `cacheComponents`

The model changes substantially.

Next 16.3.5 says Cache Components builds a static shell and lets request-time work live below `<Suspense>` boundaries; the fallback is placed into that static shell and the dynamic subtree resolves/streams at request time. Next calls this Partial Prerendering and says it is the default rendering behavior with Cache Components. ([Next.js](https://nextjs.org/docs/app/getting-started/partial-prerendering?utm_source=chatgpt.com))

Then this shape makes sense:

```tsx
import { Suspense } from "react";

export default function Page() {
  return (
    <>
      <MarketingContent />

      <Suspense fallback={<HomeFrame state="loading" />}>
        <AuthenticatedHomeServer />
      </Suspense>
    </>
  );
}
```

`AuthenticatedHomeServer` can call Clerk `auth()` and then `preloadQuery`; it remains request-time/personalized, while static marketing content outside the boundary can remain in the shell. That is the cleanest PPR architecture for your combined marketing/app homepage. ([Next.js](https://nextjs.org/docs/app/getting-started/partial-prerendering?utm_source=chatgpt.com))

### `partialPrefetching` is a different switch

Do not conflate it with PPR. In 16.3.5, `partialPrefetching` is a **navigation prefetch optimization** introduced in 16.3.0. It requires `cacheComponents`; when enabled it prefetches one reusable App Shell per route instead of URL-specific route payloads by default. Its default is `false`. ([Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/partialPrefetching))

So the sensible adoption order would be:

```ts
// phase 1
cacheComponents: true,
partialPrefetching: false,
```

and evaluate `partialPrefetching` separately later. It has no bearing on whether Convex should use `useQuery` versus `preloadQuery`.

---

## Should authenticated Convex data be cached with `"use cache"`?

**Framework capability:** technically, Next permits request-derived values to be read outside a `"use cache"` scope and passed in as arguments; those arguments become cache-key inputs. Ordinary `"use cache"` entries are server cached/shared, and `"use cache: remote"` is explicitly shared across users. Next's own documentation says that for most user data, fetching directly from the source is usually preferable. ([Next.js](https://nextjs.org/docs/app/getting-started/partial-prerendering?utm_source=chatgpt.com))

**My policy recommendation:** **never put personalized authenticated Convex query results into a shared Next server cache by default.**

Not because Next makes it impossible, but because you would be building a second consistency/invalidation system around a database that already automatically caches deterministic query results and invalidates them when dependencies change. You would also make correct user/session cache partitioning and auth revocation part of your cache correctness story. Convex already automatically caches queries and updates those cached results when their dependencies change. ([Convex](https://docs.convex.dev/functions/query-functions?utm_source=chatgpt.com))

There are three exceptions/distinctions:

- **Request-local memoization:** good. `React.cache()` around your token/auth helper is fine. It is request-scoped. ([Next.js](https://nextjs.org/docs/app/getting-started/fetching-data?utm_source=chatgpt.com))
- **Public, identity-independent Convex content:** caching can be reasonable if stale data is explicitly acceptable.
- **`"use cache: private"`:** Next says this stores results only in the browser's memory, not in a server cache—but in 16.3.5 it is explicitly **experimental and not recommended for production**. I would not build your Convex policy around it. ([Next.js](https://nextjs.org/docs/app/api-reference/directives/use-cache-private?utm_source=chatgpt.com))

So: **authenticated Convex data: fresh from Convex; public content: optionally cache.**

---

# 3. Is server preloading actually worth it?

There is no official Next/Convex benchmark I could find for **Next 16.3.5 + Convex 1.45.0 + Clerk 7.9.2** giving a universal “preload saves N ms” result. Any such number would be **UNVERIFIED** and heavily deployment-region/network/query dependent.

What *is* documented allows us to reason about the two pipelines.

### Client `useQuery`

```text
static/server HTML with stable app placeholder
        ↓
client JS + Clerk/Convex auth readiness
        ↓
Convex WebSocket subscription
        ↓
real app data
```

Convex confirms that without preload, Client Components initially render in a loading state, and that the React client uses a WebSocket for subscriptions. ([Convex](https://docs.convex.dev/client/react/nextjs/server-rendering))

Upside: no authenticated Convex read is placed on your Next server's critical render path, and no query result has to be embedded into the initial RSC payload. For your marketing-first `/`, that is particularly attractive.

Downside: the user's **personalized meaningful content** cannot appear until browser JS/auth/query readiness.

### `preloadQuery`

```text
incoming HTTP request
      ↓
Clerk auth/getToken
      ↓
Next server → Convex HTTP query
      ↓
RSC/HTML contains preloaded value
      ↓
browser hydrates
      ↓
Convex live subscription takes over
```

Convex guarantees the server-fetched initial value and subsequent reactivity. It also explicitly says the server helpers use the stateless HTTP client, while the React client uses WebSocket subscriptions. ([Convex](https://docs.convex.dev/client/react/nextjs/server-rendering))

So there **are two transport phases**: server HTTP query and browser live subscription. Calling that a “duplicate fetch” is slightly misleading. Convex automatically caches deterministic query results, so the later subscription may use a cached query result rather than cause duplicate database work. Whether a particular first WebSocket subscription after a Next preload produces another backend execution for every 1.45.0 case is **UNVERIFIED**; Convex does not document a Next-specific “resume the exact SSR subscription with zero redundant work” guarantee. ([Convex](https://docs.convex.dev/functions/query-functions?utm_source=chatgpt.com))

### Hydration/transfer cost

`preloadQuery` necessarily transfers the opaque preloaded result through the RSC/Client Component boundary, so there are additional serialized result bytes compared with rendering only a placeholder. Convex documents that the `Preloaded` payload is passed from server to Client Component. ([Convex](https://docs.convex.dev/client/react/nextjs/server-rendering))

How much CPU that adds to hydration for your result shape is **UNVERIFIED**; do not assume “SSR is faster” or “SSR hydration is expensive” without measuring your actual payload.

### What I would measure

For both variants, record:

| Measurement | What it answers |
|---|---|
| LCP | Does either strategy delay your public first screen? |
| custom `app-data-ready` mark | When does signed-in useful data actually appear? |
| RSC/HTML transferred bytes | How much does preloading inflate first navigation? |
| browser main-thread/hydration duration | Is serialization/hydration meaningful? |
| Next server response/stream timings | Did Convex enter the critical server path? |
| Convex query cache-hit rate | Is the post-hydration subscription causing meaningful backend work? |

Convex exposes query cache-hit rate in its deployment metrics and includes a `cached` field plus run reason such as `initialSubscription` in function-execution log streams, which gives you a concrete way to test the “duplicate work” concern rather than speculate. ([Convex](https://docs.convex.dev/dashboard/deployments/functions?utm_source=chatgpt.com))

### Recommendation

For this product, start with **`useQuery` + geometry-stable placeholder**. Promote a query to preload only if an experiment shows a meaningful improvement in signed-in first-content timing **without materially worsening public LCP/TTFB/RSC bytes**.

I would expect the best preload candidate to be one small composite “home summary”, not lists, feeds, secondary panels, or below-the-fold content.

---

# 4. Mutations: `useMutation` vs Server Action + `fetchMutation`

## Default: direct client `useMutation`

Convex's React client automatically retries mutations until confirmation, with the backend ensuring a mutation invocation executes once despite those retries; `useMutation` also supports local optimistic updates that Convex automatically rolls back/reconciles when the mutation completes. ([Convex](https://docs.convex.dev/client/react/overview?utm_source=chatgpt.com))

That matches an app-like interactive surface:

```tsx
"use client";

import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export function RenameButton() {
  const rename = useMutation(api.documents.rename);

  async function submit(id: string, name: string) {
    try {
      await rename({ id, name });
    } catch (error) {
      // Show mutation-specific stable inline error UI.
    }
  }

  // ...
}
```

For interactions where the network round trip is visible, add `withOptimisticUpdate`; that's Convex's native mechanism rather than inventing separate React state. ([Convex](https://docs.convex.dev/client/react/optimistic-updates?utm_source=chatgpt.com))

### Recommendation

Use this for essentially all ordinary product interactions: toggle, rename, create, reorder, dismiss, edit, etc.

---

## Server Action + `fetchMutation`

Convex officially supports `fetchMutation` inside Next Server Actions and Route Handlers. ([Convex](https://docs.convex.dev/client/react/nextjs/server-rendering))

```ts
// src/app/actions/create-item.ts
"use server";

import { fetchMutation } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import { requireConvexToken } from "@/lib/server/convex-auth";

export async function createItem(formData: FormData) {
  const token = await requireConvexToken();

  const name = String(formData.get("name") ?? "");

  await fetchMutation(
    api.items.create,
    { name },
    { token },
  );
}
```

Use that when the operation specifically benefits from the **Next server boundary**, for example:

- native `<form action={...}>` / server-form semantics;
- setting or reading Next-owned cookies;
- a redirect controlled by Next;
- coordinating with another server-only Next dependency;
- invalidating actual Next-cached public content after the mutation.

Next's current guidance treats Server Actions as public-facing mutation endpoints and requires authentication/authorization inside each action. ([Next.js](https://nextjs.org/docs/app/guides/authentication?utm_source=chatgpt.com))

Crucially, I would **still authorize inside the Convex public mutation itself**. Convex endpoints are internet-accessible, and Convex explicitly recommends checking authentication/authorization at the beginning of every public function. The Server Action should therefore not turn into your only security boundary. ([Convex](https://docs.convex.dev/auth/overview?utm_source=chatgpt.com))

For normal app clicks, a Server Action creates:

```text
browser → Next → Convex
```

instead of the native Convex-client path. Exact additional latency is **UNVERIFIED**, but there is no architectural advantage worth that indirection unless you actually need Next-specific server behavior.

---

# 5. Errors and empty states

## Client queries

Convex query exceptions are thrown from the `useQuery` call site, and Convex recommends a React error boundary. Mutation failures are different: their Promise rejects and any optimistic update is rolled back; rendering error boundaries do not catch mutation Promise failures. ([Convex](https://docs.convex.dev/functions/error-handling/?utm_source=chatgpt.com))

So conceptually:

```text
undefined        → loading frame
[] / null        → legitimate empty frame
value            → success frame
query throws     → error boundary frame
mutation rejects → inline/form mutation-error frame
```

Do not catch a query error and silently convert it to “empty”; those are different product states.

---

## RSC/preload errors

An exception while awaiting `fetchQuery`/`preloadQuery` occurs during Server Component rendering, so the surrounding Next route-segment error boundary is the relevant framework mechanism. Next 16.3.5 `error.tsx` must be a Client Component and wraps the segment's page/nested children; its `retry()` callback re-fetches/re-renders the segment. Production Server Component error messages are intentionally generalized and receive a digest. ([Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/error))

Convex does **not** separately document a special 1.45.0 RSC error contract beyond the server helper Promise behavior, so that Convex-specific characterization is **UNVERIFIED** beyond normal Next error propagation.

Example:

```tsx
// src/app/error.tsx
"use client";

export default function Error({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <section className="min-h-[24rem]">
      <div className="grid min-h-[24rem] place-items-center">
        <div>
          <p>We couldn't load this section.</p>
          <button type="button" onClick={retry}>
            Try again
          </button>
        </div>
      </div>
    </section>
  );
}
```

### Geometry policy

Use **one outer frame contract** for all four states:

```tsx
<HomeFrame state="loading" />
<HomeFrame state="empty" />
<HomeFrame state="error" />
<HomeFrame state="ready" data={data} />
```

The frame owns the same width, minimum block size, padding, header slot, toolbar slot, and list/grid footprint. The contents change; the containing geometry does not. That is our application policy, not a framework guarantee.

For narrower Convex failures, prefer a component-level error boundary around the signed-in app panel rather than replacing your whole `/` marketing route with `app/error.tsx`.

---

# 6. The policy I would adopt

### (1) Recommended policy — short rules

1. **Default authenticated reactive reads to client `useQuery`.**
2. **Always reserve final geometry while `useQuery === undefined`; no animated skeletons or page spinner.**
3. **Put auth-required client queries below Convex `<Authenticated>`.**
4. **Preload only one small, composite above-the-fold query when measured first-paint value justifies it.**
5. **Never split logically consistent server UI across multiple `preloadQuery`s; combine the reads in one Convex query.**
6. **Use `fetchQuery` only when a server snapshot is intentionally non-reactive.**
7. **Resolve the Clerk Convex token through one server-only, request-memoized helper.**
8. **Do not shared-cache authenticated Convex query results in Next. Request memoization is fine; public identity-independent content may be cached deliberately.**
9. **Default mutations to client `useMutation`; add optimistic updates for interactions where latency is perceptible.**
10. **Use Server Action + `fetchMutation` only when you actually need Next server semantics.**
11. **Authorize every public Convex query/mutation in Convex itself, regardless of the caller.**
12. **Treat loading, empty, error, and success as distinct states but render them inside the same geometry contract.**
13. **For 16.3.5, keep `partialPrefetching` off until/unless you first adopt Cache Components; it requires Cache Components anyway.** ([Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/partialPrefetching))
14. **Do not enable Cache Components solely to improve Convex loading. Test it independently under production-like load first.**

---

## (2) Concrete code shapes to write once

**`src/lib/server/convex-auth.ts`**

```ts
import "server-only";

import { auth } from "@clerk/nextjs/server";
import { cache } from "react";

export const getConvexToken = cache(async () => {
  return (await (await auth()).getToken()) ?? undefined;
});

export async function requireConvexToken() {
  const token = await getConvexToken();

  if (!token) {
    throw new Error("Authentication required");
  }

  return token;
}
```

The token form is Convex's documented Clerk integration; the `cache()` addition is request-local deduplication. ([Convex](https://docs.convex.dev/client/react/nextjs/server-rendering))

**`convex/home.ts` — one composite first-screen query**

```ts
import { query } from "./_generated/server";

export const summary = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new Error("Unauthenticated");
    }

    // Fetch everything whose mutual consistency matters here.
    const user = /* ... */;
    const primaryItems = /* ... */;
    const unreadCount = /* ... */;

    return {
      user,
      primaryItems,
      unreadCount,
    };
  },
});
```

All reads in that query share one logical Convex timestamp. ([Convex](https://docs.convex.dev/functions/query-functions?utm_source=chatgpt.com))

**Default client path**

```tsx
<Authenticated>
  <HomeLive />
</Authenticated>
```

```tsx
function HomeLive() {
  const data = useQuery(api.home.summary);

  return data === undefined
    ? <HomeFrame state="loading" />
    : <HomeFrame state="ready" data={data} />;
}
```

**Selective server-preload path**

```tsx
async function AuthenticatedHomeServer() {
  const token = await requireConvexToken();

  const preloaded = await preloadQuery(
    api.home.summary,
    {},
    { token },
  );

  return <HomePreloadedClient preloaded={preloaded} />;
}
```

If Cache Components is eventually enabled:

```tsx
<>
  <Marketing />

  <Suspense fallback={<HomeFrame state="loading" />}>
    <AuthenticatedHomeServer />
  </Suspense>
</>
```

That keeps the personalized request-time subtree behind the PPR boundary instead of caching it. ([Next.js](https://nextjs.org/docs/app/getting-started/partial-prerendering?utm_source=chatgpt.com))

**Mutation default**

```tsx
const updateItem = useMutation(api.items.update);
await updateItem(args);
```

Add `.withOptimisticUpdate(...)` where worthwhile. ([Convex](https://docs.convex.dev/client/react/optimistic-updates?utm_source=chatgpt.com))

**Next-owned mutation exception**

```ts
"use server";

const token = await requireConvexToken();
await fetchMutation(api.items.update, args, { token });

// Only if you actually have Next-cached public content to invalidate:
// revalidateTag(...), updateTag(...), etc.
```

Convex expressly supports `fetchMutation` from Server Actions. ([Convex](https://docs.convex.dev/client/react/nextjs/server-rendering))

---

## (3) Trade-offs rejected, and why

**“SSR/preload everything.”** Rejected. It loses client-subscription consistency across separate server calls, puts auth + Convex HTTP work on the render path, increases transferred RSC data, and under your current flags turns `/` dynamic. ([Convex](https://docs.convex.dev/client/react/nextjs/server-rendering))

**“Client-only everything, no preload ever.”** Also rejected. A small above-the-fold signed-in view may genuinely benefit from arriving server-rendered; Convex intentionally provides `preloadQuery` for exactly that case. ([Convex](https://docs.convex.dev/client/react/nextjs/server-rendering))

**“Cache personalized Convex data in Next.”** Rejected as a default because Convex already gives deterministic query caching/reactive invalidation, while a second cache requires you to define staleness, identity partitioning and invalidation again. ([Convex](https://docs.convex.dev/functions/query-functions?utm_source=chatgpt.com))

**“Run all writes through Server Actions for security.”** Rejected. Server Actions themselves must be treated as public-facing endpoints, while Convex is already the authorization-bearing backend and direct `useMutation` gives you its retry/reactivity/optimistic-update client model. ([Next.js](https://nextjs.org/docs/app/guides/authentication?utm_source=chatgpt.com))

**“Enable `partialPrefetching` to solve data loading.”** Rejected. It is a route-navigation prefetch mechanism, not a Convex data-consistency or SSR mechanism, and it requires Cache Components. ([Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/partialPrefetching))

---

## (4) Open risks

**Convex Next SSR is still beta.** Convex explicitly labels the Next server-rendering integration beta, so keep your preload surface small enough that future API changes are cheap. ([Convex](https://docs.convex.dev/client/react/nextjs/server-rendering))

**No exact-stack performance benchmark exists in the official material I found.** The preload-vs-client decision must therefore be settled by your production-like measurements; numeric latency/hydration assumptions are **UNVERIFIED**.

**Cache Components on Next 16.3.x currently has a serious reported memory-regression risk.** An open Next.js GitHub issue dated August 26 reports roughly 2 MiB retained/request in a reproduction with `cacheComponents: true`; the reporter reproduced through 16.3.3 and titles it as a 16.3.x regression. I did **not** find proof that the same reproduction has been run against **16.3.5**, so impact on your exact version is **UNVERIFIED**, but I would not switch Cache Components on in production without a load test or confirmed upstream fix. ([GitHub](https://github.com/vercel/next.js/issues/97938?utm_source=chatgpt.com))

That last point is enough for me to keep your present **`cacheComponents: false`, `partialPrefetching: false`** setup for now and implement the data layer assuming **static/public marketing shell + client Convex app state**. When the 16.3.x Cache Components issue is resolved or you validate 16.3.5 yourself, PPR becomes the clean way to selectively introduce server-preloaded personalized islands without sacrificing the public `/` shell.
