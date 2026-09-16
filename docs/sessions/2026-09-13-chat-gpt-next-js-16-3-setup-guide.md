# Next.js 16.3 Setup Guide

Source: https://chatgpt.com/share/6aa68656-d9fc-83eb-b0d2-922b35982b1d

---

## Turn 1: User

_2026-09-13T11:03:31.773Z_

Go through every Next.js 16.3 setting that matters for a new App
  Router app deployed on Vercel.
  1. next.config.ts: reactCompiler (babel-plugin-react-compiler
  requirement and build-speed cost with Turbopack), typedRoutes,
  cacheComponents / "use cache", `agentRules`, turbopack options
  (filesystem cache in dev/build), experimental flags worth enabling
  in 16.3, images (remotePatterns, formats), poweredByHeader,
  headers() for security headers (CSP with Clerk and Convex
  websockets), logging, output mode on Vercel. Mark each default,
  recommended, or avoid.
  2. `proxy.ts` (formerly middleware.ts): location with `src/`,
  runtime, matcher best practices, Clerk's `clerkMiddleware`
  placement.
  3. Required and reserved file conventions in 16.3 (layout, page,
  loading, error, global-error, not-found, global-not-found,
  forbidden, unauthorized, instrumentation, instrumentation-client,
  opengraph-image, icon, robots, sitemap, manifest, route groups,
  parallel routes). List any new or deprecated ones since 15.
  4. The `node_modules/next/dist/docs/` bundled docs and the
  AGENTS.md integration: what they are and how they are meant to be
  used.
  5. Env variables: the load order of .env files, NEXT_PUBLIC_
  inlining at build time, `@next/env`, runtime env on Vercel, and
  type-safe validation (t3-env vs zod by hand vs nothing).
  6. Fonts (next/font local vs Google), metadata API, viewport, and
  turning telemetry off (`next telemetry disable` vs
  NEXT_TELEMETRY_DISABLED).
  7. Deprecations and breaking changes between Next 16.0 and 16.3.5
  that affect a fresh setup.

---

## Turn 2: ChatGPT

_2026-09-13T11:03:33.751Z_

I’ll treat this as a fresh-production setup audit for **Next.js 16.3.5 + App Router on Vercel**, and I’ll separate **framework defaults** from what I’d actually enable. I’ll also verify the newer 16.3-only pieces (`agentRules`, bundled docs, proxy changes, cache semantics, and any 16.0→16.3.5 breakage) against current first-party docs/release notes.

---

## Turn 3: ChatGPT

_2026-09-13T11:03:51.939Z_

A couple of important defaults are already clear: **Turbopack is the default bundler in 16**, dev filesystem caching is already on by default from 16.1, and `reactCompiler` is stable but still opt-in because it invokes Babel and costs compile time. I’m checking the 16.3 additions now, especially whether the newer Rust React Compiler changes that recommendation and which experimental flags are actually mature enough for a new production app.

---

## Turn 4: ChatGPT

_2026-09-13T11:04:29.464Z_

For the Clerk/Convex combination, the main security gotcha is CSP: Clerk now has first-party CSP support in `clerkMiddleware()`, which is safer than hard-coding a brittle policy in `next.config.ts`. If you do keep CSP in `headers()`, Convex’s browser client needs its deployment origin in `connect-src` for both HTTPS and its realtime WebSocket connection; I’ll show the concrete pattern and where a nonce-based policy becomes preferable.

---

## Turn 5: ChatGPT

_2026-09-13T11:15:36.753Z_

As of **September 13, 2026**, **Next.js 16.3.5** is the current stable release, released September 11. For a new App Router app on Vercel, I’d start there rather than an earlier 16.3 patch: 16.3.3 included critical security fixes, and 16.3.5 includes fixes for CSP nonces, `use cache`, `next/image`, and standalone tracing. ([Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/useTypeScriptCli))

I’ll use:

- **✅ Recommended** — I would set/adopt this on a new production app.
- **◻️ Default** — the framework default is already right; leave it unset.
- **⚠️ Conditional** — useful when you specifically need the behavior.
- **⛔ Avoid** — don't enable for a normal production app yet.

---

# 1. `next.config.ts`

## The settings that matter

| Setting | 16.3.5 default | Verdict | What I would do |
|---|---|---|---|
| `reactCompiler` | `false` | ✅ Recommended | Turn it on for a greenfield app. Install `babel-plugin-react-compiler`. |
| `experimental.turbopackRustReactCompiler` | `false` | ⛔ Avoid production | Faster and removes Babel requirement, but explicitly experimental. |
| `typedRoutes` | `false` | ✅ Recommended | Turn on for a TS app. |
| `cacheComponents` | `false` | ✅ Recommended for greenfield | Adopt the new caching model deliberately. |
| `partialPrefetching` | `false` | ✅ Recommended with Cache Components | Particularly attractive in a new app with no legacy prefetch behavior. |
| `agentRules` | enabled behavior | ◻️ Default | Leave auto-generation enabled. |
| Turbopack | default bundler | ◻️ Default | Don't add flags merely to enable it. |
| Turbopack dev filesystem cache | `true` | ◻️ Default | Leave unset. |
| Turbopack build filesystem cache | `true` in 16.3 | ◻️ Default | Leave unset. |
| Turbopack memory eviction | enabled | ◻️ Default | Leave alone. |
| `images.remotePatterns` | no arbitrary remote hosts | ✅ Recommended | Strictly allow only origins/paths you use. |
| `images.formats` | WebP | ◻️ Default | Keep WebP unless AVIF economics justify it. |
| `poweredByHeader` | `true` | ✅ set `false` | No good reason to advertise it. |
| `headers()` | none | ✅ Recommended | Add basic security headers; let Clerk own CSP. |
| `logging` | sensible dev defaults | ◻️ Default | Usually leave unset. |
| `output` | normal Next deployment | ◻️ Default on Vercel | Do not use `standalone` or `export` unless you have a separate reason. |

### `reactCompiler`

The ordinary stable implementation still runs the React Compiler through **`babel-plugin-react-compiler`**. Next does an SWC pre-pass so Babel is only applied where relevant, which limits the cost, but builds/dev compilation can still be somewhat slower than pure SWC/Turbopack. ([Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/reactCompiler?utm_source=chatgpt.com))

So:

```bash
pnpm add -D babel-plugin-react-compiler
```

```ts
reactCompiler: true
```

I would enable it in a new app unless you discover a measurable build-time regression that matters more than its runtime/component ergonomics.

There is a separate 16.3 experiment:

```ts
experimental: {
  turbopackRustReactCompiler: true,
}
```

That runs the compiler natively inside Turbopack and **does not require `babel-plugin-react-compiler`**. Next measured substantially faster compilation in large apps, but the documentation explicitly says it is experimental and not recommended for production. ([Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackRustReactCompiler))

**Verdict:** stable Babel implementation ✅; Rust implementation ⛔ for production for now.

---

### `typedRoutes`

Turn it on:

```ts
typedRoutes: true
```

It is stable and catches invalid literal routes in `Link`, router navigation, etc. It requires TypeScript. Do not use the old `experimental.typedRoutes`. ([Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/typedRoutes?utm_source=chatgpt.com))

**Verdict: ✅ Recommended.**

---

### `cacheComponents` and `"use cache"`

This is the most important architectural choice.

```ts
cacheComponents: true
```

changes the model so **runtime/dynamic work is dynamic unless you explicitly cache it**, while `'use cache'` lets you mark functions/components/pages as reusable cached work. `cacheLife()` and `cacheTag()` build on top of that. ([Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents?utm_source=chatgpt.com))

For example:

```ts
async function getPlans() {
  'use cache'

  return db.plan.findMany()
}
```

Do **not** think of `cacheComponents: true` as just renaming the old PPR flag. In Next 16 it subsumes/replaces the previous `experimental.ppr`, `experimental.dynamicIO`, and `experimental.useCache` model, and migration can expose places where uncached asynchronous work needs Suspense or explicit caching. ([Next.js](https://nextjs.org/docs/app/guides/upgrading/version-16?utm_source=chatgpt.com))

For a **new 16.3 app**, I would use:

```ts
cacheComponents: true,
partialPrefetching: true,
```

Next's own 16.3 announcement presents those two flags together as the entry point to the new Instant Navigation model, and its September adoption guide specifically says new projects can enable Partial Prefetching without the legacy-prefetch audit existing apps need. ([Next.js](https://nextjs.org/blog/next-16-3))

The major exception is **strict nonce-based CSP**. More on that below.

**Verdict: ✅ for greenfield; ⚠️ if your security architecture requires nonce CSP everywhere.**

---

### `partialPrefetching`

Requires `cacheComponents`.

Instead of prefetching a complete destination for every link, Next builds a reusable **App Shell per route**, including static/cached content, then streams what remains. `<Link prefetch={true}>` can additionally include cached URL-specific content. ([Next.js](https://nextjs.org/docs/app/guides/adopting-partial-prefetching))

For a new app:

```ts
cacheComponents: true,
partialPrefetching: true,
```

is what I would choose.

**Verdict: ✅ Recommended for a new Cache Components app.**

---

### `agentRules`

In 16.3, `next dev` maintains a managed section of root `AGENTS.md` telling coding agents to consult the **version-matched Next docs bundled in your installed package**. Next explicitly says leaving auto-generation on is a good default. Your own instructions outside the managed markers are preserved. ([Next.js](https://nextjs.org/docs/app/guides/ai-agents))

Only opt out with:

```ts
agentRules: false
```

if your repo has a deliberate corporate/agent-instruction policy that conflicts with it.

**Verdict: ◻️ Default — leave enabled.**

---

## Turbopack

Turbopack has been the default for both:

```bash
next dev
next build
```

since Next 16. You no longer need `--turbo`/`--turbopack`. ([Next.js](https://nextjs.org/docs/app/guides/upgrading/version-16?utm_source=chatgpt.com))

Don't add an empty:

```ts
turbopack: {}
```

There is no value in doing so. Add a `turbopack` section only when you actually need `rules`, `resolveAlias`, `resolveExtensions`, `root`, etc. ([Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack?utm_source=chatgpt.com))

### Filesystem caching

There is an annoying documentation-version wrinkle here. An older config-reference snapshot still says the build cache is experimental, but the actual **16.3 release explicitly states build disk caching is enabled by default**, after dev caching became default in 16.1. ([Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackFileSystemCache?utm_source=chatgpt.com))

Therefore don't cargo-cult this into a new config:

```ts
experimental: {
  turbopackFileSystemCacheForDev: true,
  turbopackFileSystemCacheForBuild: true,
}
```

They are already on.

For CI, the build cache only buys you something when `.next/cache` is persisted/restored. Vercel handles the deployment/build ecosystem for you; don't manually fight it unless you have measured a cache problem.

**Verdict: ◻️ Default.**

---

## Experimental flags actually worth considering

16.3 deliberately has relatively few experiments I would put near production.

| Flag | Recommendation |
|---|---|
| `experimental.turbopackRustReactCompiler` | ⛔ Wait; explicitly non-production |
| `experimental.useOffline` | ⚠️ Only if offline/reconnect behavior matters to the product |
| `experimental.typedEnv` | ⚠️ Nice editor types, but not runtime validation |
| `experimental.useTypeScriptCli` | ◻️ Already enabled by default in 16.3; don't set it |
| `experimental.globalNotFound` | ⚠️ Useful for apps with multiple root layouts / awkward global 404 requirements |
| `experimental.authInterrupts` | ⛔ I would not base Clerk authorization architecture on it yet |
| experimental Turbopack chunk tuning | ⛔ Measure first; not a greenfield default |
| `staleTimes` | ⛔ Not a normal production recommendation |

A notable 16.3 change is that the TypeScript CLI checker is **already enabled by default**. That is what enables `next build` to work with TypeScript 7, whose JS compiler API isn't available. If you install TypeScript 7, you don't need to add the flag. ([Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/useTypeScriptCli))

---

## Images

### `remotePatterns`

Use `remotePatterns`, not `images.domains`.

Make patterns as narrow as practical:

```ts
images: {
  remotePatterns: [
    {
      protocol: 'https',
      hostname: 'images.example.com',
      pathname: '/products/**',
    },
  ],
},
```

Avoid a generic `https://**` equivalent. The image optimizer is an HTTP fetcher; broad patterns unnecessarily expand what your server can retrieve/optimize.

`images.domains` is deprecated in favor of strict `remotePatterns`.

### Formats

The normal default is WebP. AVIF can produce smaller files but takes longer to encode and has its own cache entry. For most SaaS/product apps I'd retain WebP until image traffic makes AVIF meaningfully beneficial.

Also, if you do enable AVIF, stay on **16.3.4+**: the August security patch temporarily affected AVIF handling, and subsequent patches restored it. On 16.3.5 you're fine.

**Verdict:** `remotePatterns` ✅; default WebP ◻️; AVIF ⚠️.

---

## `poweredByHeader`

Set:

```ts
poweredByHeader: false,
```

The default is to send `X-Powered-By: Next.js`. Removing it is low-cost fingerprint reduction.

**Verdict: ✅ Recommended.**

---

# CSP and security headers with Clerk + Convex

This is an area where I would **not** put everything in `next.config.ts`.

Clerk now has first-party CSP generation in `clerkMiddleware()`. Current Clerk docs recommend `@clerk/nextjs >= 7.7.8` so its own protection domains and non-443 ports are automatically accounted for. It supports both a default CSP and a per-request nonce-based strict mode. ([Clerk](https://clerk.com/docs/guides/secure/best-practices/csp-headers?utm_source=chatgpt.com))

Convex's React client communicates reactively over a **WebSocket**, and you normally initialize it from `NEXT_PUBLIC_CONVEX_URL`, e.g. `https://foo.convex.cloud`. Therefore your CSP's `connect-src` must permit the Convex deployment, including its WebSocket connection. ([Convex](https://docs.convex.dev/client/react/deployment-urls?utm_source=chatgpt.com))

I would make **Clerk the single owner of CSP**:

```ts
// src/proxy.ts

import { clerkMiddleware } from '@clerk/nextjs/server'

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL

const convexConnectSources = convexUrl
  ? [convexUrl, convexUrl.replace(/^https:/, 'wss:')]
  : []

export default clerkMiddleware({
  contentSecurityPolicy: {
    directives: {
      'connect-src': convexConnectSources,
    },
  },
})
```

Clerk merges your additional directives into its own required policy. ([Clerk](https://clerk.com/docs/guides/secure/best-practices/csp-headers?utm_source=chatgpt.com))

Then use `next.config.ts -> headers()` for the boring global headers:

```ts
async headers() {
  return [
    {
      source: '/(.*)',
      headers: [
        {
          key: 'X-Content-Type-Options',
          value: 'nosniff',
        },
        {
          key: 'Referrer-Policy',
          value: 'strict-origin-when-cross-origin',
        },
        {
          key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=()',
        },
      ],
    },
  ]
},
```

Add `X-Frame-Options: DENY` or preferably CSP `frame-ancestors 'none'` only if you're certain the product should never be embedded. HSTS is also sensible for a permanently HTTPS production domain, but don't blindly use `includeSubDomains; preload` until every relevant subdomain satisfies that promise. Next's headers API explicitly supports these standard security headers. ([Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers?utm_source=chatgpt.com))

### Strict CSP is a design choice, not a free upgrade

This:

```ts
contentSecurityPolicy: {
  strict: true,
}
```

makes Clerk generate a fresh nonce per request. `<ClerkProvider dynamic>` is then required. ([Clerk](https://clerk.com/docs/guides/secure/best-practices/csp-headers?utm_source=chatgpt.com))

But Next's own CSP docs make the tradeoff clear: nonce CSP requires dynamic rendering, disables normal static optimization/ISR, prevents ordinary CDN caching, and is **incompatible with Partial Prerendering** because the static shell cannot know the request nonce. ([Next.js](https://nextjs.org/docs/app/guides/content-security-policy?utm_source=chatgpt.com))

So I would choose one of two philosophies:

**Normal SaaS:** Cache Components + Partial Prefetching + Clerk's default automatic CSP.

**High-compliance/strict-XSS-policy app:** Clerk strict nonce CSP, accepting that it pushes pages toward dynamic rendering and undercuts the PPR/App Shell model.

Also, 16.3.5 specifically fixed nonce propagation for scripts emitted by `loading`/`template`, another reason not to stop on 16.3.0–16.3.4 when using strict CSP. ([GitHub](https://github.com/vercel/next.js/releases/tag/v16.3.5))

---

## Logging

Leave `logging` unset unless you need something.

Incoming dev requests are logged by default, and fetch logging has targeted options. Full fetch URL logging can be useful locally but can expose query-string data into logs, so I wouldn't leave:

```ts
logging: {
  fetches: {
    fullUrl: true,
  },
}
```

on reflexively. ([Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/logging?utm_source=chatgpt.com))

Browser-to-terminal logging became an important agent/dev workflow in 16.2/16.3, but again the defaults are increasingly tuned around that workflow.

**Verdict: ◻️ Default.**

---

## `output` on Vercel

Leave it absent:

```ts
// no output:
```

`output: 'standalone'` is primarily for producing a minimal deployable Node server directory for Docker/self-hosting. ([Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/output?utm_source=chatgpt.com))

`output: 'export'` means static export and gives up the server/runtime capabilities you'd normally want from Clerk + an App Router application.

Vercel knows how to deploy the normal Next build natively.

**Verdict:** unset ◻️; `standalone` ⚠️ self-hosting only; `export` ⛔ for this architecture.

---

## A production starting `next.config.ts`

For the app you've described, this is close to what I would actually begin with:

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactCompiler: true,
  typedRoutes: true,

  cacheComponents: true,
  partialPrefetching: true,

  poweredByHeader: false,

  images: {
    remotePatterns: [
      // Add only hosts/paths you actually consume.
    ],
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ]
  },
}

export default nextConfig
```

Notice what is **not** there: no Turbopack-enable flag, no filesystem-cache flags, no `output`, no logging config, no experimental Rust compiler, no explicit `agentRules`, and no CSP duplicated in `headers()`.

---

# 2. `proxy.ts`

`middleware.ts` is deprecated in Next 16 and the convention is now `proxy.ts`. The name change is intentional: Next wants this treated as a request-boundary/proxy mechanism rather than a general Express-like middleware layer. ([Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/proxy?utm_source=chatgpt.com))

### Location with `src/`

If your app is:

```text
src/
  app/
```

then use:

```text
src/proxy.ts
```

If `app/` is at root, use:

```text
proxy.ts
```

`next.config.ts`, `.env*`, `package.json`, etc. remain at project root even when application code uses `src/`. ([Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/src-folder?utm_source=chatgpt.com))

### Runtime

`proxy.ts` uses the **Node.js runtime**.

Do not write:

```ts
export const runtime = 'edge'
```

The `runtime` option is unavailable in Proxy and setting it throws. ([Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/proxy?utm_source=chatgpt.com))

That is a breaking conceptual difference from the older middleware era: don't design new Proxy logic around Edge-runtime constraints.

### Matcher

A matcher should be:

- statically analyzable;
- narrow enough to avoid `_next` internals and irrelevant static assets;
- broad enough that every request needing Clerk state actually passes through Clerk;
- explicit about API/Clerk frontend-proxy routes.

Current Clerk guidance for Next 16 is:

```ts
export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/(.*)',
  ],
}
```

([Clerk](https://clerk.com/docs/reference/nextjs/clerk-middleware?utm_source=chatgpt.com))

### Clerk placement

Make Clerk the default export:

```ts
import { clerkMiddleware } from '@clerk/nextjs/server'

export default clerkMiddleware({
  // CSP etc.
})

export const config = {
  matcher: [/* ... */],
}
```

There can only be one Proxy file/function. Compose anything else into it rather than creating a second global middleware layer. ([Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/proxy?utm_source=chatgpt.com))

Also note Clerk's current security guidance: **Proxy is not where your actual authorization should live.** Use it to establish auth/session/request infrastructure; protect the resource again where data is read/mutated — Server Component, Server Action, Route Handler, Convex function, etc. Clerk's older `createRouteMatcher()` route-protection pattern is now deprecated. ([Clerk](https://clerk.com/docs/reference/nextjs/clerk-middleware?utm_source=chatgpt.com))

---

# 3. Reserved App Router file conventions

Only a few are literally required. A root `layout.tsx` is required for an App Router tree, and a `page.tsx` makes a segment addressable. Everything else is opt-in behavior.

| Convention | Purpose / status | 15 → 16 notes |
|---|---|---|
| `layout.tsx` | Shared persistent layout; root layout contains `<html>`/`<body>` | Existing |
| `page.tsx` | Makes a route segment routable | Existing |
| `loading.tsx` | Segment Suspense/loading UI | Existing; increasingly important to instant navigation semantics |
| `error.tsx` | Client error boundary for descendants | Existing |
| `global-error.tsx` | Catches errors in root layout/template; must provide its own document shell | Existing |
| `not-found.tsx` | UI for `notFound()` and root unmatched URLs | Existing |
| `global-not-found.tsx` | Routing-level global 404 independent of layouts | **Introduced 15.4, still experimental** |
| `forbidden.tsx` | UI for `forbidden()` | **Introduced 15.1 experimental** |
| `unauthorized.tsx` | UI for `unauthorized()` | **Introduced 15.1 experimental** |
| `instrumentation.ts` | Server startup instrumentation / request-error hooks | Stabilized in 15 |
| `instrumentation-client.ts` | Browser startup/performance instrumentation | **Introduced 15.3** |
| `opengraph-image.*` | Static or generated OG image metadata | Existing |
| `twitter-image.*` | Same idea for Twitter/X cards | Existing |
| `icon.*` / `apple-icon.*` / `favicon.ico` | Icon metadata conventions | Existing |
| `robots.txt` / `robots.ts` | Robots metadata route | Existing |
| `sitemap.xml` / `sitemap.ts` | Sitemap metadata route | Existing |
| `manifest.json` / `manifest.ts` | Web app manifest | Existing |
| `(group)` | Route group; does not alter URL | Existing |
| `@slot` | Parallel-route slot; does not alter URL | Existing |
| `default.tsx` | Parallel-route hard-navigation fallback | **More important in 16; explicit defaults required for named slots** |
| `route.ts` | Route Handler for HTTP verbs | Existing |
| `template.tsx` | Layout-like boundary that remounts on navigation | Existing |
| `proxy.ts` | Request proxy/auth/header/redirect boundary | **New canonical name in 16; `middleware.ts` deprecated** |

The current 16.3.5 file-system reference includes `default`, `error`, `forbidden`, instrumentation files, layout/loading/not-found/page, parallel routes, Proxy, route groups, Route Handlers, template and unauthorized, plus the metadata-file conventions. ([Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/useTypeScriptCli))

### A few subtleties

`error.tsx` is a Client Component boundary. `global-error.tsx` has to replace the root document and therefore needs its own `<html>` and `<body>`.

`not-found.tsx` may return **200 for a streamed response and 404 for a non-streamed response**, so don't build business logic that assumes HTTP status alone mirrors a nested `notFound()`. `global-not-found.tsx` was added in 15.4 for cases such as multiple root layouts where a single normal `app/not-found.tsx` isn't sufficient. ([Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/not-found?utm_source=chatgpt.com))

Parallel-route `default.tsx` is the fallback for a slot whose active sub-route cannot be reconstructed after a hard navigation. Without one, named slots can error rather than silently guessing. ([Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/default?utm_source=chatgpt.com))

Next 16 also made metadata generator parameters async in the same spirit as the broader async request API migration: code receiving dynamic image params or sitemap IDs needs to follow the Promise-based signatures.

For a Clerk app I would **not** enable `authInterrupts` just to get `forbidden.tsx`/`unauthorized.tsx`; they remain experimental. A normal 403/401 UI/redirect and resource-level Clerk checks are more conservative.

---

# 4. `node_modules/next/dist/docs/` and `AGENTS.md`

This is a real 16.2/16.3 feature, not generated noise.

Next now ships its documentation *inside the `next` npm package*:

```text
node_modules/next/dist/docs/
├── 01-app/
│   ├── 01-getting-started/
│   ├── 02-guides/
│   └── 03-api-reference/
├── 02-pages/
├── 03-architecture/
└── index.mdx
```

The point is that an AI coding agent can read documentation matching the **exact framework version installed in your repo**, rather than relying on stale model knowledge or whatever current web docs happen to say. No network request is necessary. ([Next.js](https://nextjs.org/docs/app/guides/ai-agents?utm_source=chatgpt.com))

16.3 takes that further: `next dev` maintains a marked block in root `AGENTS.md` essentially saying “this version has breaking changes; consult `node_modules/next/dist/docs/` before writing Next.js code.” It will re-add/update that managed block if necessary. Your instructions outside:

```text
<!-- BEGIN:nextjs-agent-rules -->
...
<!-- END:nextjs-agent-rules -->
```

are preserved. `CLAUDE.md` normally imports `AGENTS.md` so Claude Code receives the same project instructions. ([Next.js](https://nextjs.org/docs/app/guides/ai-agents))

The intended workflow is therefore:

```text
Agent gets Next.js task
        ↓
Reads AGENTS.md
        ↓
Finds exact relevant file under node_modules/next/dist/docs/
        ↓
Implements against installed Next version
        ↓
Uses running next dev / diagnostics for verification
```

It is **not** intended as application documentation you import at runtime, and you shouldn't edit anything in `node_modules/next/dist/docs/`.

16.2 bundled the docs but did not yet auto-maintain the AGENTS block; **16.3 added the automatic maintenance behavior**. ([Next.js](https://nextjs.org/docs/app/guides/ai-agents))

**Recommendation: commit the generated `AGENTS.md`/`CLAUDE.md` and keep your own engineering rules outside the managed block.**

---

# 5. Environment variables

## Load order

Next stops at the first definition it finds:

1. `process.env`
2. `.env.$NODE_ENV.local`
3. `.env.local` — skipped under `NODE_ENV=test`
4. `.env.$NODE_ENV`
5. `.env`

`.env*` lives at the project root, **not under `src/`**. ([Next.js](https://nextjs.org/docs/pages/guides/environment-variables?utm_source=chatgpt.com))

Example production precedence:

```text
process.env
.env.production.local
.env.local
.env.production
.env
```

### `NEXT_PUBLIC_`

A variable such as:

```env
NEXT_PUBLIC_CONVEX_URL=https://example.convex.cloud
```

is replaced into browser code at **build time**. Once built, that client value is frozen. Dynamic property access like:

```ts
process.env[name]
```

isn't eligible for the same compile-time inlining. ([Next.js](https://nextjs.org/docs/pages/guides/environment-variables?utm_source=chatgpt.com))

That means `NEXT_PUBLIC_` does **not** mean “a magical runtime client environment variable.” It means “safe to expose, and compile its value into browser bundles.”

Server-only:

```ts
process.env.CLERK_SECRET_KEY
```

can be read at server request/runtime when execution is genuinely dynamic. ([Next.js](https://nextjs.org/docs/app/guides/self-hosting?utm_source=chatgpt.com))

### Vercel runtime semantics

On Vercel, environment variables are available to the **Build Step** and/or **Function execution** depending on environment/configuration. But changing a Vercel env value **does not mutate an already-created deployment**; the new value applies to a new deployment. ([Vercel](https://vercel.com/docs/environment-variables?utm_source=chatgpt.com))

So the practical mental model is:

```text
NEXT_PUBLIC_FOO
→ captured by next build
→ baked into browser bundle for that deployment

SECRET_FOO
→ server-only process.env
→ available during server/function execution
→ but the deployment's configured env set is still tied to that deployment
```

### `@next/env`

Use it when non-Next tooling needs exactly Next's `.env` semantics, e.g.:

```ts
// envConfig.ts
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())
```

Then import that from Drizzle/Prisma tooling, a Jest setup, standalone scripts, etc. Next itself already does this loading; don't redundantly call it inside application code. ([Next.js](https://nextjs.org/docs/pages/guides/environment-variables?utm_source=chatgpt.com))

---

## Type-safe validation: t3-env vs Zod vs nothing

For a real production app, my order would be:

| Approach | Verdict | Why |
|---|---|---|
| `@t3-oss/env-nextjs` + Zod/Valibot/etc. | ✅ Best default | Runtime validation + server/client separation + inferred TS types |
| Handwritten Zod module | ✅ Good for small env surface | Simple, fewer abstractions; you own client/server boundaries and integration |
| `experimental.typedEnv` | ⚠️ Supplemental only | Generates IntelliSense/types from loaded variables; doesn't prove production values are valid |
| Bare `process.env.X!` everywhere | ⛔ Avoid serious apps | No startup/build validation, typos/missing values surface late |

The important distinction is **typing versus validation**. Next's `experimental.typedEnv` generates `.d.ts` information from the environment seen during development. It doesn't validate that production has a valid URL, enum, secret length, etc. ([Next.js](https://nextjs.org/docs/app/api-reference/config/typescript?utm_source=chatgpt.com))

For Clerk + Convex + other infrastructure, I'd use t3-env or a centralized Zod module rather than scattered non-null assertions.

---

# 6. Fonts, metadata, viewport, telemetry

## Fonts

Both of these are good:

```ts
import { Geist } from 'next/font/google'
```

and:

```ts
import localFont from 'next/font/local'
```

`next/font/google` does **not** cause browsers to call Google Fonts. Next downloads the files at build time and self-hosts them with your static assets. `next/font/local` starts with files you control. Both optimize loading/layout shift. Next recommends variable fonts where available. ([Next.js](https://nextjs.org/docs/app/api-reference/components/font?utm_source=chatgpt.com))

My rule:

- **Google catalog font:** `next/font/google` is perfectly good.
- **Brand/licensed font or deterministic/offline builds:** `next/font/local`.
- Prefer WOFF2/variable fonts.
- Instantiate each font once, e.g. in `app/fonts.ts`, rather than repeatedly calling the font loader; every call creates a separate font instance. ([Next.js](https://nextjs.org/docs/app/api-reference/components/font?utm_source=chatgpt.com))

---

## Metadata API

Use:

```ts
export const metadata: Metadata = {
  ...
}
```

when values are known statically.

Use:

```ts
export async function generateMetadata() {
  ...
}
```

only when metadata genuinely depends on params/data.

Keep icon/OG/robots/sitemap/manifest concerns in their file conventions when that is cleaner.

With Cache Components, `generateMetadata` participates in the same static/cached/dynamic reasoning as the rest of the route. Runtime/uncached dependencies defer it to request time. ([Next.js](https://nextjs.org/docs/app/api-reference/functions/generate-metadata?utm_source=chatgpt.com))

I would set a root `metadataBase` in production if you use relative canonical/OG URLs, then let child layouts/pages compose their metadata.

---

## Viewport

Don't put viewport values in the old metadata shape.

Use:

```ts
import type { Viewport } from 'next'

export const viewport: Viewport = {
  themeColor: '#ffffff',
}
```

or, rarely:

```ts
export function generateViewport(): Viewport {
  ...
}
```

Static `viewport` is preferred if runtime information isn't needed. Next already supplies a sensible default viewport, so don't emit a custom one just because you can. ([Next.js](https://nextjs.org/docs/app/api-reference/functions/generate-viewport?utm_source=chatgpt.com))

And don't disable zoom unless you have a very unusual reason; it harms accessibility.

---

## Telemetry

For your local persistent developer environment:

```bash
pnpm exec next telemetry disable
```

stores the opt-out.

For Vercel/CI/containers where you want policy to be deterministic:

```env
NEXT_TELEMETRY_DISABLED=1
```

Both are officially supported. ([Next.js](https://nextjs.org/telemetry?utm_source=chatgpt.com))

So I prefer:

```text
Developer machine      → next telemetry disable
CI / Vercel org policy → NEXT_TELEMETRY_DISABLED=1
```

---

# 7. What actually changed from 16.0 → 16.3.5

For a new project, these are the changes worth internalizing rather than carrying 15-era habits forward.

## Next 16.0

**Runtime/tooling requirements changed.** Node **20.9+** is required; TypeScript minimum is 5.1. ([Next.js](https://nextjs.org/docs/app/guides/upgrading/version-16?utm_source=chatgpt.com))

**Turbopack became the default** for both development and production builds. A custom webpack setup is now something you deliberately opt back into with `--webpack`, rather than the normal path. ([Next.js](https://nextjs.org/docs/app/guides/upgrading/version-16?utm_source=chatgpt.com))

**Synchronous request APIs are gone.** `cookies()`, `headers()`, `draftMode()`, route `params`, and `searchParams` must be treated as async where specified. If you're starting fresh, never copy old snippets doing synchronous request access.

**Cache Components landed.** Old combinations of PPR/dynamicIO/useCache flags were consolidated behind `cacheComponents`.

**React Compiler moved to stable config**, but remained opt-in and Babel-backed. ([Next.js](https://nextjs.org/docs/app/guides/upgrading/version-16?utm_source=chatgpt.com))

**`middleware.ts` became deprecated in favor of `proxy.ts`.** Proxy is Node-runtime-only from a configuration perspective. ([Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/proxy?utm_source=chatgpt.com))

**`next lint` was removed.** Run ESLint/Biome yourself. `next build` is no longer your lint command.

**`serverRuntimeConfig` / `publicRuntimeConfig` are dead-end legacy APIs.** Use environment variables.

**AMP support was removed.**

**Image defaults tightened**, including stricter remote-image configuration and changed cache/quality behavior. Do not start a new app with `images.domains` or `next/legacy/image`.

**Parallel routes became stricter about `default.tsx`.**

**`revalidateTag` semantics changed.** The old single-argument “expire immediately” mental model is deprecated; cache profiles and `updateTag()` are now part of the intended model.

---

## 16.1

The big greenfield-relevant change was **Turbopack filesystem caching for `next dev` becoming stable/default**. ([Next.js](https://nextjs.org/blog))

No config needed.

---

## 16.2

The AI/dev workflow matured:

- versioned docs were bundled with Next;
- `create-next-app` became agent-ready with `AGENTS.md`;
- browser log forwarding became a normal part of the agent/dev loop;
- duplicate dev-server detection/lock handling improved;
- the Adapter API stabilized. ([Next.js](https://nextjs.org/blog))

If you're writing a new repo now, don't delete AGENTS files because they look autogenerated.

---

## 16.3

This is the substantial minor release.

**Build filesystem caching became default**, not just dev caching. **Memory eviction** is also enabled in dev, with Next reporting dramatic RAM reductions in large dev sessions. ([Next.js](https://nextjs.org/blog/next-16-3))

**Partial Prefetching** arrived as the second half of the modern Cache Components navigation model:

```ts
cacheComponents: true,
partialPrefetching: true,
```

([Next.js](https://nextjs.org/blog/next-16-3))

**AGENTS auto-maintenance** moved into `next dev`. ([Next.js](https://nextjs.org/docs/app/guides/ai-agents))

**TypeScript 7 support** became practical through the CLI type checker; the CLI checker is now the default path in 16.3. ([Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/useTypeScriptCli))

**Rust React Compiler** arrived, but experimental. ([Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackRustReactCompiler))

**Offline/network resilience** arrived behind `experimental.useOffline`.

There are also newer navigation/debugging primitives, root-param helpers, `import.meta.glob`, improved ISR behavior under Cache Components, and custom error-boundary functionality. ([Next.js](https://nextjs.org/blog/next-16-3))

---

## 16.3.3 → 16.3.5

This patch range matters more than usual.

On **August 25, 2026**, Next published 16.3.3 as an Active-LTS security release addressing **two Critical vulnerabilities**. ([Next.js](https://nextjs.org/blog))

16.3.5, released September 11, contains additional backported fixes including:

- avoiding corrupt/empty `next/image` disk-cache entries;
- standalone adapter output tracing;
- adding CSP nonces to `loading`/`template` scripts;
- fixing a `use cache` prerender-signal issue. ([GitHub](https://github.com/vercel/next.js/releases/tag/v16.3.5))

So for a new project today, I would not write:

```json
"next": "16.3.0"
```

Start with **16.3.5 or later patched 16.3.x**, keep the lockfile committed, and automate patch updates.

---

# My recommended 16.3.5 baseline

For a **new Vercel + App Router + Clerk + Convex** codebase, the choices I would make are:

```text
Next                           16.3.5+
Node                           20.9+; current LTS preferable
Turbopack                      default
Turbopack FS cache             default
React Compiler                 ON, stable Babel implementation
Rust React Compiler            OFF
typedRoutes                    ON
cacheComponents                ON
partialPrefetching             ON
agentRules                     default/on
TypeScript CLI checker         default/on
typedEnv                       unnecessary if using t3-env
env validation                 t3-env or centralized Zod
images.remotePatterns          strict allow-list
images.formats                 default WebP initially
poweredByHeader                false
logging                        defaults
output                         unset on Vercel
proxy                          src/proxy.ts when using src/
proxy runtime                  Node; don't configure it
Clerk CSP                      generated in clerkMiddleware()
Convex CSP                     add https + wss deployment origins
strict nonce CSP               only if requirements justify losing PPR/static benefits
security headers               next.config headers()
fonts                          next/font
metadata                       Metadata API + metadata files
viewport                       static Viewport export unless genuinely dynamic
telemetry in CI                NEXT_TELEMETRY_DISABLED=1 if policy requires it
```

The one choice I would revisit before locking the architecture is **strict CSP versus Cache Components/Partial Prefetching**. Everything else above is a fairly straightforward 16.3 greenfield baseline.
