# Rendering Model Recommendation

Source: https://chatgpt.com/share/6aa6a197-17b4-83eb-a3a4-3733b462bd40

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



  Design the rendering model for a single route `/` that serves both
  a public, SEO-relevant marketing funnel (signed out) and the
  authenticated app (signed in).
  1. Options: (a) statically prerendered page that switches
  client-side on auth state (Convex
  <Authenticated>/<Unauthenticated>/<AuthLoading>, or Clerk's
  useAuth), (b) dynamic server render reading Clerk `auth()` per
  request, (c) Next 16 Cache Components / Partial Prerendering:
  static shell plus a streamed dynamic auth-dependent hole in
  <Suspense>, (d) a proxy rewrite to different internal routes based
  on session (e.g. `/` → `/(marketing)` vs `/(app)`), (e) anything
  else current and credible. For each: TTFB, CDN cacheability, SEO
  of the signed-out page, flash of wrong content, CLS, and cost on
  Vercel.
  2. How does `auth()` in a Server Component interact with static
  rendering, `cacheComponents`, `"use cache"`, and `connection()` in
  Next 16.3? Does `clerkMiddleware` or `ClerkProvider` (with or
  without its `dynamic` prop) force dynamic rendering?
  3. Clerk's handshake and `__client_uat` / `__session` cookies: can
  the server cheaply and reliably tell "probably signed in" before
  clerk-js loads? What does Clerk recommend for avoiding a
  signed-out flash for returning users?
  4. The rewrite approach (d): how do crawlers, prefetching,
  typedRoutes, `<Link>`, and the URL bar behave, and does Clerk
  document this pattern?
  5. Which option best satisfies "no CLS, no skeleton animations, no
  page spinners" while keeping the funnel fast and indexable?
  Recommend one and give the file layout.

---

**ChatGPT**

I’ll verify this against the tagged/source material for Next 16.3.5, Convex 1.45.0, and `@clerk/nextjs` 7.9.2, then separate guaranteed behavior from architectural judgment. I’ll pay special attention to `auth()`, Cache Components/PPR, Clerk’s cookie handshake, and rewrite/prefetch semantics because those are the places where version drift matters most.

---

**ChatGPT**

The Next 16.3.5 tagged docs confirm an important distinction already: with Cache Components **off**, a request-time API makes the route dynamic; with Cache Components **on**, the same access can be isolated behind `<Suspense>` so the rest becomes a CDN-served static shell. Also, `cookies()`/`headers()` are forbidden inside plain `"use cache"`; they must be read outside and passed in, or handled with the private-cache variant.

---

**ChatGPT**

The exact Clerk 7.9.2 source adds another nuance: `auth()` literally builds its request state from Next’s `headers()`, so it is request-dependent and explicitly errors inside `"use cache"`. Conversely, `<ClerkProvider dynamic>` in 7.9.2 reads dynamic auth state but contains its own script/header read in `Suspense`, with a source comment saying this is specifically to remain statically renderable under PPR. That is more precise than Clerk’s generic rendering guide, which still describes `dynamic` as opting a route into dynamic rendering.

---

**ChatGPT**

## Recommendation

For this particular product shape, I would use **(d), but in a constrained form**:

> **Keep `/` as the real, statically prerendered marketing page. In `clerkMiddleware()`, only rewrite authenticated requests for `/` to a private internal app route such as `/_app`.**

Do **not** rewrite signed-out `/` to a second marketing route. Let it continue to the actual `src/app/page.tsx`. That preserves the cleanest possible SEO/static story for the public funnel.

For the signed-in target, I would make `/_app` a **static application shell with client-side Convex data** unless there is a concrete reason to server-render private user data. Your existing `ConvexProviderWithClerk` is designed around Clerk's client `useAuth`; in Convex 1.45.0 it uses the native Clerk integration whenever the session JWT has `aud === "convex"`. ([GitHub](https://raw.githubusercontent.com/get-convex/convex-js/main/src/react-clerk/ConvexProviderWithClerk.tsx))

This gives you the property PPR cannot give you cleanly at `/`: **the first HTML document is already the correct full-page family—marketing or app—without putting the marketing funnel behind an auth-loading boundary.**

I would **not enable `cacheComponents` merely to solve this problem**. It is useful technology, but it is not the best primitive for a route whose two auth states are essentially two different pages.

---

# 1. Comparing the rendering models

The performance column below is deliberately qualitative. Exact TTFB milliseconds and exact Vercel spend depend on deployment region, traffic, cache hit ratio, function duration, and plan; those figures are therefore **UNVERIFIED** for your deployment.

| Model | Initial TTFB | CDN/cacheability | Signed-out SEO | Wrong-content flash | CLS fit | Vercel compute |
|---|---|---|---|---|---|---|
| **(a) Static `/` + client auth switch** | Best route-level TTFB | Excellent | **Problematic if marketing sits only in `<Unauthenticated>`** | Fundamental tension | Can technically reserve space, but whole-page switch is awkward | Lowest Next render compute |
| **(b) Dynamic SSR with `auth()`** | Per-request render | Whole route dynamic with Cache Components off | Excellent | None | Excellent | Highest/simple per-request model |
| **(c) Cache Components/PPR + auth hole** | Static shell arrives quickly | Shell cacheable; auth hole request-time | Good, but marketing cannot simultaneously be the safe signed-in fallback | Avoidable only with neutral fallback | Possible, but awkward for two radically different pages | Static shell + dynamic work |
| **(d) Clerk Proxy rewrite** | Proxy decision first; destination then loads | Marketing remains a static artifact; Proxy runs first | **Excellent** | **None on a correctly resolved document request** | **Excellent** | Proxy compute + whatever destination needs |
| **(e) Separate public `/` and authenticated `/app`** | Excellent | Excellent | Excellent | None | Excellent | Low | Architecturally cleanest, but violates your product requirement |

Next 16.3.5 says Proxy executes before route rendering and can rewrite the request to another page; a rewrite changes the route that produces the response without changing the visible URL. ([GitHub](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/docs/01-app/03-api-reference/03-file-conventions/proxy.mdx))

### (a) Static page + `useAuth` / Convex auth boundaries

This is attractive until you look at the loading state.

In Convex 1.45.0, `ConvexProviderWithClerk` maps Clerk's `!isLoaded` to Convex `isLoading`, and maps `isSignedIn ?? false` to `isAuthenticated`. ([GitHub](https://raw.githubusercontent.com/get-convex/convex-js/main/src/react-clerk/ConvexProviderWithClerk.tsx)) Convex's own helpers then do this:

- `<Authenticated>` renders nothing while auth is loading.
- `<Unauthenticated>` also renders nothing while auth is loading.
- `<AuthLoading>` is the thing that renders during that interval. ([GitHub](https://raw.githubusercontent.com/get-convex/convex-js/main/src/react/auth_helpers.tsx))

So this shape:

```tsx
<Unauthenticated>
  <Marketing />
</Unauthenticated>

<Authenticated>
  <App />
</Authenticated>
```

does **not** give you “the statically rendered marketing funnel first, then swap to the app.” During unresolved client auth, neither branch is the intended page.

You could instead make:

```tsx
<AuthLoading>
  <Marketing />
</AuthLoading>
```

but then a returning signed-in user is explicitly shown the marketing page until auth resolves.

That is the core problem with (a), not React performance.

**Framework guarantee:** client auth lets the route itself remain static because the server render does not need request auth.

**Recommendation:** do not use client auth as the top-level selector between your entire funnel and your entire application. It is excellent *inside* the app for smaller auth-sensitive regions.

For SEO, you could put a duplicate static representation of the funnel outside the auth switch and hide/remove it later, but that creates accessibility, duplicate-content, hydration, and flash complexity. I would reject that.

---

## (b) Dynamic Server Component with Clerk `auth()`

This is the simplest correctness model:

```tsx
export default async function Page() {
  const { userId } = await auth()

  return userId ? <App /> : <Marketing />
}
```

For your current `cacheComponents: false`, this makes `/` request-rendered.

That follows directly from Clerk 7.9.2's implementation: `auth()` calls `buildRequestLike()`, and that function obtains the current Next request from `headers()`. ([GitHub](https://raw.githubusercontent.com/clerk/javascript/%40clerk/nextjs%407.9.2/packages/nextjs/src/app-router/server/auth.ts)) Next 16.3's rendering model treats request-time APIs as dynamic when Cache Components is not enabled. ([GitHub](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/docs/01-app/02-guides/migrating-to-cache-components.mdx))

The upside is excellent:

- server knows the branch before sending the page;
- no signed-out flash;
- no auth-loading UI;
- signed-out HTML contains the actual marketing content;
- CLS is straightforward because each request starts with its final page.

The downside is equally straightforward: **you turn the one route that should be your cheapest, most cacheable acquisition surface into request compute for everybody.**

Clerk's current rendering guide describes `auth()` as the choice when auth must be available on the first render. ([Clerk](https://clerk.com/docs/guides/development/rendering-modes))

**Recommendation:** (b) is my second choice. If the Proxy/rewrite navigation edge cases prove unacceptable in testing, use dynamic SSR rather than fighting client flashes.

---

# 2. `auth()`, static rendering, Cache Components, `"use cache"`, and `connection()`

There are two distinct Next 16.3.5 modes.

## With `cacheComponents: false` — your configuration today

Calling Clerk `auth()` in the route render is effectively a request-time `headers()` dependency. Clerk 7.9.2 constructs a request from Next's request headers before resolving auth. ([GitHub](https://raw.githubusercontent.com/clerk/javascript/%40clerk/nextjs%407.9.2/packages/nextjs/src/app-router/server/auth.ts))

So:

```tsx
// cacheComponents: false

export default async function Page() {
  const { userId } = await auth()
  // ...
}
```

makes that render request-dependent.

You do **not** need:

```tsx
await connection()
```

in addition. `connection()` exists for code that needs to opt out of prerendering **without already using a request-time API**. Next 16.3.5 explicitly describes it that way. ([GitHub](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/docs/01-app/03-api-reference/04-functions/connection.mdx))

### `"use cache"`

Do not put `auth()` inside a normal `"use cache"` scope.

Clerk 7.9.2 catches Next's corresponding cache error and replaces it with a Clerk-specific explanation; Clerk's utility explicitly says auth must be read outside the cached function and the required values passed in. ([GitHub](https://raw.githubusercontent.com/clerk/javascript/%40clerk/nextjs%407.9.2/packages/nextjs/src/app-router/server/auth.ts))

Correct conceptual shape:

```tsx
async function getPublicThing(userTier: string) {
  "use cache"

  return expensiveLookup(userTier)
}

export default async function Page() {
  const { sessionClaims } = await auth()

  const tier =
    typeof sessionClaims?.tier === "string"
      ? sessionClaims.tier
      : "default"

  const data = await getPublicThing(tier)

  return <View data={data} />
}
```

The **cache key must contain only whatever variation is safe to share**. Do not casually pass a user ID into a public shared cache and assume that makes private-data caching safe.

---

## With `cacheComponents: true`

Next 16.3.5 says Cache Components enables a statically prerendered HTML shell while request-time work streams later; PPR is part of Cache Components rather than a separate `experimental.ppr` mode. ([GitHub](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/docs/01-app/03-api-reference/05-config/01-next-config-js/cacheComponents.mdx))

So this becomes credible:

```tsx
export default function Page() {
  return (
    <>
      <StaticChrome />

      <Suspense fallback={<StableAuthFallback />}>
        <AuthDependentSection />
      </Suspense>
    </>
  )
}

async function AuthDependentSection() {
  const { userId } = await auth()

  return userId ? <App /> : <Marketing />
}
```

The static material outside the auth boundary can be prerendered while the request-time subtree becomes the dynamic hole. That is precisely what Cache Components is designed to permit. ([GitHub](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/docs/01-app/03-api-reference/05-config/01-next-config-js/cacheComponents.mdx))

But that does not eliminate your product-design problem: **what belongs in `fallback`?**

If it is `<Marketing />`, a signed-in user gets the wrong page briefly.

If it is `<AppShell />`, a signed-out user gets the wrong page briefly.

If it is neutral empty chrome, there is no wrong-content flash, but your actual SEO funnel is no longer the static shell.

Hence my recommendation not to choose PPR for the root bifurcation.

### `connection()` with Cache Components

Still do not add `connection()` around `auth()`.

Next 16.3.5 says `connection()` waits for a real request and should only be used where you genuinely need that semantic; with Cache Components, Next explicitly suggests its newer Cache Components mechanisms where appropriate and says `connection()` is for work that must await a real user request. ([GitHub](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/docs/01-app/03-api-reference/04-functions/connection.mdx))

`auth()` already has the request dependency.

---

# Does `clerkMiddleware()` force dynamic rendering?

**No.**

Next Proxy is executed **before routes are rendered** and is a separate stage in the routing pipeline. ([GitHub](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/docs/01-app/03-api-reference/03-file-conventions/proxy.mdx)) Nothing about merely having `src/proxy.ts` means every matched page has to be dynamically rendered by React.

There is nevertheless a runtime cost: Proxy code executes for matching requests. On Vercel, its deployment/billing behavior is separate from whether the destination page itself was prerendered. Vercel currently documents Routing Middleware/Proxy as executing before the cache and being charged through its compute model. ([vercel.com](https://vercel.com/docs/routing-middleware?utm_source=chatgpt.com))

So distinguish:

> **static rendering** ≠ **zero server-side request processing**

You can have a static page behind a per-request Proxy decision.

---

# Does `<ClerkProvider>` force dynamic rendering?

### Default `<ClerkProvider>`

**No.**

Clerk changed this behavior before 7.x: a normal root provider does not inherently make the whole application dynamically rendered. Clerk's current guidance distinguishes the normal static/client-auth provider from the `dynamic` mode. ([Clerk](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/nextjs-v6?utm_source=chatgpt.com))

Your current root arrangement is therefore reasonable:

```tsx
<ClerkProvider>
  <ConvexClientProvider>{children}</ConvexClientProvider>
</ClerkProvider>
```

### `<ClerkProvider dynamic>`

This is different.

In Clerk 7.9.2 the dynamic provider path obtains request state server-side. Its implementation is intentionally designed to work with PPR, and Clerk's source contains explicit Suspense handling around its request-sensitive script work. ([GitHub](https://raw.githubusercontent.com/clerk/javascript/%40clerk%2Fnextjs%407.9.2/packages/nextjs/src/app-router/server/ClerkProvider.tsx))

Clerk's rendering guide recommends **scoping** a dynamic provider rather than making the whole app dynamic, and for PPR shows it behind Suspense. ([Clerk](https://clerk.com/docs/guides/development/rendering-modes))

So I would not do:

```tsx
// root layout
<ClerkProvider dynamic>
  {children}
</ClerkProvider>
```

for this application.

You gain nothing versus your Proxy selector and risk spreading request dependence across the whole tree.

---

# 3. Clerk handshake and `__client_uat` / `__session`

This is where I would be particularly strict:

> **Do not implement your own `request.cookies.has("__session")` test to decide whether `/` is the app.**

It is not a reliable authentication state machine.

In Clerk 7.9.2's backend code, the cookie-auth flow tracks both an active-client signal (`clientUat`) and the session token. Cases including:

- neither cookie,
- session without client UAT,
- client UAT without session,
- session token issued before the client-UAT timestamp,

all have distinct behavior, and several may require refresh/handshake rather than simply being “signed out.” ([GitHub](https://raw.githubusercontent.com/clerk/javascript/%40clerk/nextjs%407.9.2/packages/backend/src/tokens/request.ts))

For example, the exact 7.9.2 code does:

```text
client UAT present + session absent
    -> maybe handshake

session present + client UAT absent
    -> maybe handshake

session.iat < client UAT
    -> maybe handshake
```

and it cryptographically verifies an acceptable session token before yielding signed-in state. ([GitHub](https://raw.githubusercontent.com/clerk/javascript/%40clerk/nextjs%407.9.2/packages/backend/src/tokens/request.ts))

So:

- `__session` **presence** is a useful hint, not authentication.
- a valid verified `__session` is authoritative for that request;
- `__client_uat` is an active-client/update signal used in Clerk's consistency logic, not proof that the browser currently has a valid session.

Clerk's architecture also has auth state that the application origin cannot simply infer from those two cookies in every stale-session case; that is why the handshake exists.

### Handshake eligibility matters

Clerk 7.9.2's `HandshakeService` says explicitly that it treats a request as handshake-eligible when it is probably a **document navigation**: GET plus `Sec-Fetch-Dest: document`/`iframe`, or a compatible HTML accept header when that fetch metadata is absent. ([GitHub](https://raw.githubusercontent.com/clerk/javascript/%40clerk/nextjs%407.9.2/packages/backend/src/tokens/handshake.ts))

That matters a great deal for your rewrite design.

If Clerk finds an ambiguous/stale state and the request is eligible, it can send the browser through Clerk's Frontend API handshake and come back with definitive session state. ([GitHub](https://raw.githubusercontent.com/clerk/javascript/%40clerk/nextjs%407.9.2/packages/backend/src/tokens/handshake.ts))

In Clerk 7.9.2, `clerkMiddleware()` calls `authenticateRequest()` **before invoking your middleware callback**. If Clerk's request state contains a handshake redirect, it returns that redirect before your callback is called; only after obtaining a usable signed-in/signed-out state does it invoke your handler. ([GitHub](https://raw.githubusercontent.com/clerk/javascript/%40clerk/nextjs%407.9.2/packages/nextjs/src/server/clerkMiddleware.ts))

That is exactly why this:

```ts
clerkMiddleware(async (auth, request) => {
  const { userId } = await auth()

  if (request.nextUrl.pathname === "/" && userId) {
    // ...
  }
})
```

is materially safer than parsing Clerk cookies yourself.

### What should you use to prevent a returning-user signed-out flash?

Clerk's documented rendering options are essentially:

1. resolve auth server-side (`auth()`) when auth must exist on the first render; or
2. use appropriately scoped dynamic provider/PPR behavior where request auth is needed server-side. ([Clerk](https://clerk.com/docs/guides/development/rendering-modes))

For **your** design, my recommendation is a third application of Clerk's server auth machinery: let `clerkMiddleware()` resolve the request before selecting the destination.

That conclusion is my architectural recommendation, not a quoted Clerk “same-URL landing page” recipe.

---

# 4. The rewrite approach in detail

There is stronger first-party support for the general pattern than you might expect.

Next 16.3.5's `<Link>` documentation itself uses an authenticated-vs-visitor **Proxy rewrite** as the example for Proxy-aware prefetching: a public displayed URL can rewrite to different backing routes depending on auth, and `<Link>` must know the actual target if you want accurate prefetching. ([GitHub](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/docs/01-app/03-api-reference/02-components/link.mdx))

Clerk 7.9.2 also explicitly supports auth propagation across **same-origin rewrites**. Its `decorateRequest()` checks for a Next rewrite, verifies the origin is unchanged, and adds Clerk's authenticated request state to the rewritten downstream request. ([GitHub](https://raw.githubusercontent.com/clerk/javascript/%40clerk/nextjs%407.9.2/packages/nextjs/src/server/utils.ts))

So the general mechanism is well supported.

### Does Clerk specifically document “`/` → marketing/app depending on session”?

**UNVERIFIED.**

I did not find a Clerk 7.9.2 guide recommending that exact product architecture.

What is verified is:

- Next 16.3.5 documents auth-dependent Proxy rewrites as a valid pattern. ([GitHub](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/docs/01-app/03-api-reference/02-components/link.mdx))
- Clerk 7.9.2 source explicitly preserves Clerk auth across same-origin `NextResponse.rewrite()`. ([GitHub](https://raw.githubusercontent.com/clerk/javascript/%40clerk/nextjs%407.9.2/packages/nextjs/src/server/utils.ts))

That is sufficient for me to recommend it, but I would not describe it as a Clerk-prescribed pattern.

---

## URL bar

A rewrite keeps the browser-facing URL.

Next describes rewrites as proxying to a destination while masking the destination. ([GitHub](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/docs/01-app/03-api-reference/03-file-conventions/proxy.mdx))

So:

```text
Browser:  /
Proxy:    rewrite internally to /_app
Address:  /
```

There is no visible `/dashboard` or `/_app` transition.

---

## Crawlers

Do not special-case bots.

A crawler with no valid Clerk session traverses the same Proxy and lands on the ordinary static `src/app/page.tsx`.

That gives search engines an ordinary canonical `/` containing your actual funnel rather than a generic auth shell.

I would set the internal application route to `noindex` defensively because `/_app` is still a real filesystem route unless you take extra steps to block/directly redirect it.

---

## `typedRoutes`

Keep `/` as an actual `page.tsx`.

Then:

```tsx
<Link href="/">Home</Link>
```

remains a normal typed route.

Next's typed-routes documentation distinguishes real filesystem routes from Proxy-only aliases; Proxy-generated route strings may otherwise need explicit `Route` casts because the compiler cannot derive arbitrary Proxy behavior. ([GitHub](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/docs/01-app/03-api-reference/05-config/02-typescript.mdx))

Your proposed design avoids that issue for the public URL because `/` genuinely exists.

`/_app` is also a real typed route if it has `src/app/_app/page.tsx`.

Route groups do **not** let you solve this by creating both:

```text
(marketing)/page.tsx  -> /
(app)/page.tsx        -> /
```

because the two pages resolve to the same URL and conflict. Next route groups omit the group name from the URL rather than creating independently selectable versions of that URL. ([GitHub](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/docs/01-app/03-api-reference/03-file-conventions/route-groups.mdx))

---

# Prefetching is the biggest caveat

Next explicitly warns that when Proxy decides between authenticated and unauthenticated destinations, naïve prefetching cannot necessarily know which underlying route to prefetch. Its documented solution is to give `<Link>` both the display URL and the backing target. ([GitHub](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/docs/01-app/03-api-reference/02-components/link.mdx))

You *could* do that after Clerk client auth is loaded.

I would not.

It couples your route topology to client auth state and recreates a race you were trying to remove.

For links whose purpose is “go to the canonical home experience,” I recommend:

```tsx
<Link href="/" prefetch={false}>
  Home
</Link>
```

when a client transition is acceptable.

But there is an additional Clerk-specific wrinkle: `prefetch={false}` disables prefetch; it does **not** turn `<Link>` into a browser document navigation.

Because Clerk 7.9.2 limits some handshake recovery to document-like GETs, I would use a plain anchor where you explicitly need to re-resolve stale auth after a potentially long-lived tab:

```tsx
<a href="/">Home</a>
```

A document navigation gives Clerk's handshake machinery the request shape it explicitly considers eligible. ([GitHub](https://raw.githubusercontent.com/clerk/javascript/%40clerk/nextjs%407.9.2/packages/backend/src/tokens/handshake.ts))

I would not mechanically replace every `<Link href="/">` with `<a>`. The important places are **crossing or re-entering the auth-selected root after long idle periods**, particularly after returning from hosted account flows.

This deserves an integration test.

---

# 5. Why I prefer the rewrite over PPR for your exact UI rules

PPR is most compelling when one page has:

> stable shared shell + several independently dynamic regions.

Your `/` is different:

> **entire acquisition website** OR **entire authenticated product**.

Those are two page identities sharing one URL.

With PPR, the static shell must be something valid before auth resolves. There is no fallback that simultaneously gives you:

- full static marketing HTML for SEO;
- zero marketing flash to a signed-in user;
- full app first paint;
- zero neutral/loading state.

The Proxy can know which entire page identity should be rendered before React builds either page.

That is the better architectural boundary.

---

# Recommended file layout

```text
src/
├─ app/
│  ├─ layout.tsx
│  ├─ page.tsx                  # REAL `/`: static marketing funnel
│  │
│  ├─ _app/
│  │  ├─ page.tsx              # internal backing route for signed-in `/`
│  │  └─ layout.tsx            # optional app-only chrome
│  │
│  ├─ robots.ts
│  └─ sitemap.ts
│
├─ components/
│  ├─ marketing/
│  │  ├─ marketing-home.tsx
│  │  └─ ...
│  │
│  └─ app/
│     ├─ app-home.tsx
│     ├─ app-home-loading.tsx
│     └─ ...
│
├─ providers/
│  └─ convex-client-provider.tsx
│
└─ proxy.ts

convex/
├─ schema.ts
├─ ...
```

I would actually consider a less magic-looking pathname such as `/_authenticated-home` if `_app` might be confused with internal Next terminology. The leading underscore does **not itself constitute security**.

---

# Concrete code shapes

## `next.config.ts`

For now:

```ts
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  typedRoutes: true,

  // Deliberately not needed for the root auth split.
  cacheComponents: false,
  partialPrefetching: false,

  reactCompiler: true,

  // your existing static CSP...
}

export default nextConfig
```

Cache Components is opt-in in 16.3.5 and encompasses PPR when enabled; `partialPrefetching` is a separate feature layered on top and requires Cache Components. ([GitHub](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/docs/01-app/03-api-reference/05-config/01-next-config-js/cacheComponents.mdx))

I would revisit both independently later, not as part of this root-routing decision.

---

## `src/proxy.ts`

```ts
import { clerkMiddleware } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"

export default clerkMiddleware(async (auth, request) => {
  const { pathname } = request.nextUrl

  if (pathname === "/") {
    const { userId } = await auth()

    if (userId) {
      return NextResponse.rewrite(
        new URL("/_authenticated-home", request.url),
      )
    }

    // Signed out: do NOT rewrite.
    // Let the real static `/` page win.
    return NextResponse.next()
  }

  // Prevent the backing URL becoming a second public/canonical URL.
  if (pathname === "/_authenticated-home") {
    return NextResponse.redirect(new URL("/", request.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
```

The important ordering guarantee is in Clerk's 7.9.2 implementation: `authenticateRequest()` runs before your handler, handshake redirects are handled before the handler, and your `auth` callback is built from the resulting request state. ([GitHub](https://raw.githubusercontent.com/clerk/javascript/%40clerk/nextjs%407.9.2/packages/nextjs/src/server/clerkMiddleware.ts))

Clerk then decorates a same-origin rewrite with the auth state needed downstream. ([GitHub](https://raw.githubusercontent.com/clerk/javascript/%40clerk/nextjs%407.9.2/packages/nextjs/src/server/utils.ts))

### One caveat

The “direct `/_authenticated-home` request redirects, but an internal rewrite from `/` successfully reaches that route without re-entering your Proxy as another fresh browser request” behavior follows Next's documented Proxy-before-filesystem routing model. ([GitHub](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/docs/01-app/03-api-reference/03-file-conventions/proxy.mdx))

I would nevertheless make this an integration test in `next build && next start` and on Vercel, because route/rewrite behavior is important enough here not to trust only dev mode.

---

## `src/app/page.tsx`

No auth. No Suspense for auth. No Clerk query.

```tsx
import { MarketingHome } from "@/components/marketing/marketing-home"

export const metadata = {
  title: "…",
  description: "…",
}

export default function HomePage() {
  return <MarketingHome />
}
```

This should remain a boring static page.

That is a feature.

---

## `src/app/_authenticated-home/page.tsx`

If your app data is already Convex/client-driven:

```tsx
import { AppHome } from "@/components/app/app-home"

export const metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

export default function AuthenticatedHomeBackingPage() {
  return <AppHome />
}
```

No `auth()` is required merely to select the top-level page because Proxy already did that.

But **authorization must still live at the data boundary**. Next explicitly warns that Proxy should not be the sole security boundary for server operations. ([GitHub](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/docs/01-app/03-api-reference/03-file-conventions/proxy.mdx)) Convex functions handling private data must continue to check authenticated identity/authorization themselves.

---

## Client app state with Convex

Use auth/loading boundaries *inside* the already-selected application, not to choose marketing versus application:

```tsx
"use client"

import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
} from "convex/react"

export function AppHome() {
  return (
    <>
      <Authenticated>
        <LoadedAppHome />
      </Authenticated>

      <AuthLoading>
        <AppHomePlaceholder />
      </AuthLoading>

      <Unauthenticated>
        <SessionLost />
      </Unauthenticated>
    </>
  )
}
```

That matches Convex 1.45.0's exact helper semantics. ([GitHub](https://raw.githubusercontent.com/get-convex/convex-js/main/src/react/auth_helpers.tsx))

Your `AppHomePlaceholder` should have the **same structural geometry** as the loaded above-the-fold app:

```tsx
function AppHomePlaceholder() {
  return (
    <main>
      <header className="h-16" />
      <section className="min-h-[calc(100dvh-4rem)]">
        {/* static, nonanimated reserved regions */}
      </section>
    </main>
  )
}
```

No shimmer. No spinner. No decorative transition.

If private content can remain blank until Convex authenticates, use stable empty boxes or static chrome. Do not fill them with fake text that disappears.

---

# If you instead choose PPR later

The correct Next 16.3 shape is:

```tsx
import { Suspense } from "react"
import { auth } from "@clerk/nextjs/server"

export default function Page() {
  return (
    <StaticSharedShell>
      <Suspense fallback={<NeutralFixedGeometry />}>
        <AuthBranch />
      </Suspense>
    </StaticSharedShell>
  )
}

async function AuthBranch() {
  const { userId } = await auth()

  return userId
    ? <AuthenticatedExperience />
    : <PublicExperience />
}
```

Do not add `connection()` here.

Do not put `auth()` in `"use cache"`.

Do not put `<MarketingHome />` in the fallback unless you explicitly accept signed-in users briefly seeing it.

---

# Vercel cost and caching nuance

The clean cost ordering I would expect is:

```text
cheapest route render
static destination
    <
PPR static shell + dynamic work
    <
full dynamic SSR
```

but Proxy sits orthogonally to that:

```text
matched request
    → Proxy compute
    → cached/static or dynamically rendered destination
```

Vercel's current documentation says Routing Middleware executes before the cache and is a suitable mechanism for personalizing otherwise static content. ([vercel.com](https://vercel.com/docs/routing-middleware?utm_source=chatgpt.com))

Because you already intend to run `clerkMiddleware()` on `/`, using its already-resolved auth state to perform the rewrite should not add an *additional category of request*; it adds a small branch to the Proxy code you already execute.

However:

**UNVERIFIED:** I did not find documentation pinning the exact CDN cache-key/hit behavior of **Vercel + Next 16.3.5 + Clerk 7.9.2's decorated same-origin `NextResponse.next()`/rewrite headers**. I would verify `x-vercel-cache`, function invocations, and the deployment's route output after shipping a preview.

I would treat “the page is build-time static” as verified, but not promise a particular production cache hit ratio without that deployment measurement.

---

# Important open issue: client navigation after stale auth

This is the largest risk I see in the preferred architecture.

Clerk's exact 7.9.2 handshake code only permits handshake redirects for document-like GET requests. ([GitHub](https://raw.githubusercontent.com/clerk/javascript/%40clerk/nextjs%407.9.2/packages/backend/src/tokens/handshake.ts)) A Next App Router client navigation is not necessarily the same kind of request as a browser document navigation.

Therefore, this scenario needs testing:

1. user signs in;
2. tab remains open long enough for the immediately available application-domain auth token to become stale;
3. client-side navigation returns to `/`;
4. Proxy has a mismatch that would normally require handshake;
5. the RSC/navigation request is not handshake-eligible.

Clerk has newer refresh-token machinery in 7.9.2 and may resolve many expired-token cases without a handshake before falling back to it. The exact backend request code attempts eligible refreshes before handshake fallback. ([GitHub](https://raw.githubusercontent.com/clerk/javascript/%40clerk/nextjs%407.9.2/packages/backend/src/tokens/request.ts))

Nevertheless, I would test the stale-tab path explicitly.

Where robust re-entry matters more than SPA navigation, use a document anchor:

```tsx
<a href="/">Home</a>
```

That is a very small trade for deterministic Clerk handshake semantics.

---

# Final policy to adopt

1. **`/` is always the real, statically prerendered marketing page.**
2. **Only authenticated `/` requests are internally rewritten by Clerk Proxy.**
3. **Never infer Clerk login state by checking `__session` or `__client_uat` yourself.**
4. **Use the `auth` object supplied by `clerkMiddleware()` for routing decisions.**
5. **Keep the root `<ClerkProvider>` non-`dynamic`.**
6. **Do not call server `auth()` in public `/`.**
7. **Do not enable Cache Components solely for the `/` auth split.**
8. **Keep authorization in Convex/server functions even when Proxy chooses the app route.**
9. **Use stable, nonanimated app placeholders only after the app route is already selected.**
10. **Disable speculative prefetch where it can guess the wrong auth backing route; use document navigation where Clerk handshake reliability matters.**
11. **`/_authenticated-home` is an implementation route, `noindex`, and not a second product URL.**
12. **Regression-test signed-out, signed-in, stale-session, sign-out, hosted-account return, client navigation, hard refresh, bot/no-cookie, and direct backing-route requests.**

---

# Concrete code shapes to standardize on

The canonical architecture is:

```text
GET /
 │
 ▼
Clerk Proxy
 │
 ├─ Clerk definitively signed out
 │      │
 │      └── NextResponse.next()
 │             │
 │             ▼
 │        static src/app/page.tsx
 │        full SEO marketing
 │
 └─ Clerk definitively signed in
        │
        └── rewrite /_authenticated-home
                  │
                  ▼
             static app shell
                  │
                  ▼
          Clerk client + Convex auth
                  │
                  ▼
             private data
```

And not:

```text
static generic /
   ↓ hydration
"is Clerk loaded?"
   ↓
swap whole website
```

nor:

```text
PPR /
  ↓
full-page Suspense
  ↓
choose one of two unrelated pages
```

---

# Trade-offs I reject

**Static client switch (a):** cheapest mechanically, but it moves your most important routing decision until after auth hydration. Convex 1.45's loading semantics make the public page, the authenticated page, and the auth-loading page genuinely three states. ([GitHub](https://raw.githubusercontent.com/get-convex/convex-js/main/src/react-clerk/ConvexProviderWithClerk.tsx)) You would have to choose between weak initial SEO, a marketing flash for returning users, or a neutral blank state.

**Full dynamic SSR (b):** correct and simple, but wastes request rendering on anonymous acquisition traffic when your marketing page is inherently static.

**PPR root bifurcation (c):** technically supported in Next 16.3.5, but optimizes the wrong boundary. Cache Components excels at static shell + dynamic regions; your two auth states are different pages. ([GitHub](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/docs/01-app/03-api-reference/05-config/01-next-config-js/cacheComponents.mdx))

**Separate `/app` URL (e):** technically the cleanest architecture, but it violates the deliberate requirement that the home route itself is the signed-in product.

**Raw cookie routing:** rejected outright. Clerk 7.9.2's state machine proves the presence/absence combinations are not equivalent to authenticated/unauthenticated. ([GitHub](https://raw.githubusercontent.com/clerk/javascript/%40clerk/nextjs%407.9.2/packages/backend/src/tokens/request.ts))

**Root `<ClerkProvider dynamic>`:** too broad. It turns request auth into a root concern when only one routing decision needs it.

**`connection()` around `auth()`:** redundant. `auth()` already consumes request state; `connection()` is intended for request-dependent work that otherwise has no request API. ([GitHub](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/docs/01-app/03-api-reference/04-functions/connection.mdx))

---

# Open risks

The four I would put on the architecture decision record are:

1. **Next client-navigation / Clerk handshake interaction.** Clerk 7.9.2 handshake eligibility is intentionally document-oriented. Test long-idle client transitions to `/`; use hard/document navigation at deliberate auth-boundary entry points if necessary. ([GitHub](https://raw.githubusercontent.com/clerk/javascript/%40clerk/nextjs%407.9.2/packages/backend/src/tokens/handshake.ts))

2. **Vercel cache behavior after Clerk-decorated Proxy rewrites — UNVERIFIED.** The destination can unquestionably be statically generated, and Vercel Proxy runs before caching, but verify actual production cache metrics rather than assuming a specific CDN hit ratio. ([vercel.com](https://vercel.com/docs/routing-middleware?utm_source=chatgpt.com))

3. **Prefetching.** Next 16.3.5 explicitly recognizes that auth-dependent Proxy destinations make ordinary `<Link>` prefetch ambiguous. Do not turn that into an invisible correctness dependency. ([GitHub](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/docs/01-app/03-api-reference/02-components/link.mdx))

4. **Backing-route exposure.** `/_authenticated-home` is a real route. `noindex`, redirect direct visits, and never rely on obscurity for security. The actual data authorization remains in Convex/server code. Next likewise warns not to use Proxy as the sole authorization boundary. ([GitHub](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/docs/01-app/03-api-reference/03-file-conventions/proxy.mdx))

Subject to those tests, **static real `/` + Clerk-authenticated rewrite for signed-in documents is the model I would ship for this product.** It gives the public funnel the strongest static/SEO characteristics, lets Clerk settle ambiguous returning-user state before you choose a page, and avoids forcing one full-page auth switch through either client hydration or a PPR fallback.
