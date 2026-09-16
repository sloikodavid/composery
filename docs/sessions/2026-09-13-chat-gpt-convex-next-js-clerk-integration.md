# Convex Next.js Clerk Integration

Source: https://chatgpt.com/share/6aa6854f-f288-83eb-94ed-4f0706804739

---

## Turn 1: User

_2026-09-13T11:03:25.029Z_

Give me the current best-practice integration of Convex 1.45 with
  Next.js 16.3 App Router (plus Clerk) in a single package.
  1. Client provider: ConvexProvider vs ConvexProviderWithClerk vs
  ConvexProviderWithAuth. Where it goes relative to ClerkProvider,
  and "use client" placement.
  2. Server side: preloadQuery / usePreloadedQuery, fetchQuery /
  fetchMutation in Server Components, Server Actions, and route
  handlers. How to pass the Clerk token
  (`convexAuthNextjsToken`-style helpers vs
  `auth().getToken({template})` vs the Clerk-Convex native
  integration without a JWT template). Interaction with
  cacheComponents / "use cache".
  3. Local dev: `convex dev` together with `next dev`. Compare `bun
  --parallel`, `convex dev --run-sh`, and `convex dev --once`. Local
  vs cloud dev deployments and anonymous local deployments. Which
  variables the CLI writes to `.env.local` (CONVEX_DEPLOYMENT,
  NEXT_PUBLIC_CONVEX_URL, NEXT_PUBLIC_CONVEX_SITE_URL) when it
  detects Next.
  4. Every convex.json knob in 1.45 (functions,
  node.externalPackages, node.nodeVersion, codegen.staticApi /
  staticDataModel / fileType, aiFiles, generateCommonJSApi,
  authInfo), with a recommended value for each.
  5. Deploying: Vercel build command `convex deploy --cmd 'next
  build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`, preview
  deployments, CONVEX_DEPLOY_KEY scoping, keeping prod safe.
  6. Is the `@convex-dev/react-query` / TanStack Query adapter worth
  it in 2026, or are plain `useQuery` hooks better? Also
  `convex-helpers` (which utilities are still recommended vs
  superseded by core features).

---

## Turn 2: ChatGPT

_2026-09-13T11:03:27.028Z_

I’ll ground this in the current Convex, Next.js, and Clerk docs, then turn it into one opinionated “single-package” setup with version-specific caveats. I’ll also separate what is truly 1.45-era best practice from older helper patterns that still show up in blog posts.

---

## Turn 3: ChatGPT

_2026-09-13T11:03:48.146Z_

One important 2026 change is already clear: the old “Clerk JWT template named `convex`” advice is no longer the preferred path. Clerk’s native Convex integration now makes the ordinary Clerk session token usable by Convex, and Convex’s current Next.js SSR docs call `auth().getToken()` with no template.

---

## Turn 4: ChatGPT

_2026-09-13T11:09:10.668Z_

As of **Convex 1.45.0** (published August 21, 2026), this is the setup I would use for a new **Next.js 16.3 App Router + Clerk + Convex** app. Convex’s Next.js server-rendering integration is still officially marked beta, but the provider/auth path is mature and the current Clerk integration is materially simpler than the old JWT-template setup. ([npm](https://www.npmjs.com/package/convex?activeTab=versions&utm_source=chatgpt.com))

## Recommended baseline

For a normal single-package app, the architecture should be:

```text
app/layout.tsx                    Server Component
└─ <ClerkProvider>
   └─ <ConvexClientProvider>      Client Component ("use client")
      └─ <ConvexProviderWithClerk>
         └─ app

Server Components / Actions / Route Handlers
└─ auth().getToken()
   └─ preloadQuery / fetchQuery / fetchMutation / fetchAction
```

And for local development I would make this your default:

```json
{
  "scripts": {
    "dev": "convex dev --start 'next dev'",
    "build": "next build",
    "convex:once": "convex dev --once"
  }
}
```

The key 2026 change is: **activate Clerk's native Convex integration and stop creating a special Clerk JWT template just for Convex.** Clerk's Convex integration maps the required `aud: "convex"` claim onto the normal Clerk session token; Convex's current Next.js documentation therefore uses plain `auth().getToken()` with **no `template` argument**. ([Clerk](https://clerk.com/docs/guides/development/integrations/databases/convex?utm_source=chatgpt.com))

---

# 1. Client provider

For Clerk, use **`ConvexProviderWithClerk`**, not `ConvexProvider` and not generic `ConvexProviderWithAuth`.

`ConvexProvider` is the plain unauthenticated Convex provider. `ConvexProviderWithAuth` is the generic low-level adapter for integrating an auth system for which Convex doesn't have a dedicated adapter: you provide a hook returning auth state and a token-fetch function. `ConvexProviderWithClerk` already does that Clerk-specific plumbing and token refresh for you. ([Convex](https://docs.convex.dev/api/modules/react?utm_source=chatgpt.com))

Your client boundary should look like:

```tsx
// components/ConvexClientProvider.tsx
"use client";

import type { ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!url) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
}

const convex = new ConvexReactClient(url);

export function ConvexClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
```

That file needs `"use client"` because `ConvexReactClient`, Clerk's `useAuth`, and the authenticated Convex provider are client-side concerns. You **do not** need to turn `app/layout.tsx` into a Client Component. Convex's own Next.js guide recommends exactly this client-wrapper pattern. ([Convex](https://docs.convex.dev/auth/clerk))

Then keep the root layout server-side:

```tsx
// app/layout.tsx
import { ClerkProvider } from "@clerk/nextjs";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider>
          <ConvexClientProvider>
            {children}
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
```

The order matters:

```text
ClerkProvider
  ↓
ConvexProviderWithClerk
```

not the reverse, because the Convex adapter calls Clerk's hook and therefore needs Clerk context above it. Convex explicitly documents that ordering. ([Convex](https://docs.convex.dev/auth/clerk))

For client-side auth gating, prefer:

```tsx
import {
  Authenticated,
  Unauthenticated,
  AuthLoading,
  useConvexAuth,
} from "convex/react";
```

over using Clerk's `isSignedIn` to decide whether it is safe to issue an authenticated Convex query. Clerk may know you're signed in slightly before Convex has obtained and validated the token; `useConvexAuth()` represents the state that actually matters to Convex. ([Convex](https://docs.convex.dev/auth/clerk))

Your backend config is:

```ts
// convex/auth.config.ts
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

Set `CLERK_JWT_ISSUER_DOMAIN` independently in your Convex dev/preview/prod environments. Clerk's native Convex integration gives you the Frontend API/issuer URL and preconfigures the required audience. ([Convex](https://docs.convex.dev/auth/clerk))

---

# 2. Server-side Convex

There are really two server-rendering modes.

### `preloadQuery` → `usePreloadedQuery`

Use this when you want **SSR initial data followed by normal reactive Convex behavior in the browser**.

Server:

```tsx
// app/tasks/TasksServer.tsx
import { preloadQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { getConvexToken } from "@/lib/convex-auth";
import { TasksClient } from "./TasksClient";

export async function TasksServer() {
  const token = await getConvexToken();

  const preloaded = await preloadQuery(
    api.tasks.list,
    {},
    { token },
  );

  return <TasksClient preloaded={preloaded} />;
}
```

Client:

```tsx
"use client";

import {
  type Preloaded,
  usePreloadedQuery,
} from "convex/react";
import { api } from "@/convex/_generated/api";

export function TasksClient({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.tasks.list>;
}) {
  const tasks = usePreloadedQuery(preloaded);

  return <>{/* ... */}</>;
}
```

`usePreloadedQuery` consumes the server's first result and then continues as a normal reactive Convex subscription. This is the best option for data-driven interactive screens where SSR matters. `preloadQuery` explicitly uses `cache: "no-store"`. ([Convex](https://docs.convex.dev/client/nextjs/app-router/server-rendering))

### `fetchQuery`

Use this when you want an ordinary **point-in-time server snapshot** and do not need that component to become reactive.

```tsx
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { getConvexToken } from "@/lib/convex-auth";

export default async function Page() {
  const token = await getConvexToken();

  const account = await fetchQuery(
    api.accounts.current,
    {},
    { token },
  );

  return <h1>{account?.name}</h1>;
}
```

Convex documents `fetchQuery` specifically for rendering Server Components. It does **not** establish a live subscription. ([Convex](https://docs.convex.dev/client/nextjs/app-router/server-rendering))

### Auth token helper

With Clerk's native Convex integration, make one server-only helper:

```ts
// lib/convex-auth.ts
import "server-only";

import { auth } from "@clerk/nextjs/server";

export async function getConvexToken() {
  const { getToken } = await auth();
  return (await getToken()) ?? undefined;
}
```

That corresponds to Convex's current Clerk example:

```ts
(await (await auth()).getToken()) ?? undefined
```

Again, **no `{ template: "convex" }`**. ([Convex](https://docs.convex.dev/client/nextjs/app-router/server-rendering))

### `convexAuthNextjsToken` is the wrong helper for Clerk

`convexAuthNextjsToken()` comes from **`@convex-dev/auth`**, i.e. the separate Convex Auth product. It reads Convex Auth's cookies/token state. It is not a general Convex/Next helper and should not appear in a Clerk integration. Even within Convex Auth, newer APIs introduced `convexAuth.getToken()` in preference to some of the older Next-specific helper names. ([GitHub](https://github.com/get-convex/convex-auth/blob/main/CHANGELOG.md?utm_source=chatgpt.com))

So:

```text
Clerk
→ auth().getToken()

Convex Auth
→ Convex Auth's own server helpers

Do not mix them.
```

### What about `auth().getToken({ template: "convex" })`?

That's the **legacy Clerk integration**. Convex 1.33-era compatibility code allowed `ConvexProviderWithClerk` to fall back to the old template route if the native integration wasn't enabled, which is why old examples may still work.

For a new 2026 project, activate Clerk's native Convex integration and use the session token. Custom JWT templates remain useful for integrations that genuinely require a different JWT format, but Clerk itself warns they involve additional token-generation processing/latency. ([Clerk](https://clerk.com/docs/guides/development/integrations/databases/convex?utm_source=chatgpt.com))

### Server Actions

Use `fetchMutation` / `fetchAction`:

```ts
"use server";

import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { getConvexToken } from "@/lib/convex-auth";

export async function createTask(text: string) {
  const token = await getConvexToken();

  return fetchMutation(
    api.tasks.create,
    { text },
    { token },
  );
}
```

For a pure Server Component snapshot, you may then need `revalidatePath()` or `refresh()` after mutation so Next produces a new RSC snapshot. If the UI is instead using `useQuery` / `usePreloadedQuery`, Convex's reactive subscription normally takes care of updating the client without Next cache invalidation. Convex's official Server Action example uses `fetchMutation` plus `revalidatePath()` because the displayed query itself was server-rendered with `fetchQuery`. ([Convex](https://docs.convex.dev/client/nextjs/app-router/server-rendering))

### Route handlers

Same pattern:

```ts
// app/api/tasks/route.ts
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { getConvexToken } from "@/lib/convex-auth";

export async function POST(request: Request) {
  const token = await getConvexToken();
  const { text } = await request.json();

  const id = await fetchMutation(
    api.tasks.create,
    { text },
    { token },
  );

  return Response.json({ id });
}
```

`fetchQuery`, `fetchMutation`, and `fetchAction` are specifically intended for Server Components, Server Actions and Route Handlers. They use `NEXT_PUBLIC_CONVEX_URL` automatically unless you pass `{ url }`. ([Convex](https://docs.convex.dev/client/nextjs/app-router/server-rendering))

One subtle point: `preloadQuery` and `fetchQuery` use a stateless HTTP client. Two separate server calls aren't guaranteed to observe exactly the same database snapshot. If several values need to be transactionally consistent, expose **one Convex query that returns the whole page model**, rather than issuing five server-side `preloadQuery`s. Convex explicitly recommends avoiding multiple independent `preloadQuery` calls on a page for this reason. ([Convex](https://docs.convex.dev/client/nextjs/app-router/server-rendering))

### Next 16.3 `cacheComponents` / `"use cache"`

My rule would be:

**Authenticated/personalized Convex data: don't put it in `"use cache"` by default.**

With `cacheComponents: true`, Next 16 renders uncached I/O at request time. If an async subtree accesses runtime/request data or uncached network data, it belongs under `<Suspense>`; otherwise Next can raise its “uncached data outside Suspense” build/dev error. ([Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents?utm_source=chatgpt.com))

So this is a good shape:

```tsx
export default function Page() {
  return (
    <>
      <StaticHeader />

      <Suspense fallback={<DashboardSkeleton />}>
        <AuthenticatedDashboard />
      </Suspense>
    </>
  );
}

async function AuthenticatedDashboard() {
  const token = await getConvexToken();
  const data = await fetchQuery(
    api.dashboard.get,
    {},
    { token },
  );

  return <Dashboard data={data} />;
}
```

Don't put `auth()` inside a `"use cache"` scope. Next says runtime APIs such as cookies/headers must be read outside cached scopes; values may then be passed into a cached function. ([Next.js](https://nextjs.org/docs/app/getting-started/partial-prerendering?utm_source=chatgpt.com))

For **public, non-personalized** Convex data that can intentionally be stale, a `"use cache"` wrapper can make sense:

```ts
import { cacheLife } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export async function getPublicCatalog() {
  "use cache";
  cacheLife("hours");

  return fetchQuery(api.catalog.publicList);
}
```

But this should be an explicit product decision, not an automatic “performance optimization.” Convex already maintains its own query caching/reactivity. The primary reason to add a Next cache is to get a cached/static Next output and define its staleness policy.

I would generally **not cache `preloadQuery` payloads**, especially authenticated ones: their raison d'être is a fresh SSR starting point for a live client subscription, and Convex explicitly configures them `no-store`. ([Convex](https://docs.convex.dev/client/nextjs/app-router/server-rendering))

---

# 3. Local development

For a one-package repo, my ranking is:

| Method | Recommendation | Why |
|---|---|---|
| `convex dev --start 'next dev'` | **Best default** | One command owns both lifecycles; official current CLI feature |
| `bun run --parallel ...` | Good when you want independent named processes | Better for 3+ services or clearer per-process output |
| `convex dev --run-sh ...` | Don't use in new config | Deprecated hidden alias of `--start` |
| `convex dev --once` | Setup/CI/agents only | Push/codegen once, then exit |

Current 1.45 source marks `--run-sh` as “Deprecated: use --start instead”; `--start` is the intended long-running companion-process flag. ([GitHub](https://github.com/get-convex/convex-js/blob/main/src/cli/dev.ts?utm_source=chatgpt.com))

So:

```json
{
  "scripts": {
    "dev": "convex dev --start 'next dev'"
  }
}
```

is cleaner than a process manager for this two-process case.

If you prefer Bun supervision:

```json
{
  "scripts": {
    "dev:next": "next dev",
    "dev:convex": "convex dev",
    "dev": "bun run --parallel \"dev:*\""
  }
}
```

The current Bun syntax is `bun run --parallel ...`; it supports concurrently running script sets with prefixed output. ([Bun](https://bun.sh/docs/pm/filter?utm_source=chatgpt.com))

`convex dev --once` is excellent for:

```bash
bun install
bun x convex dev --once
```

in CI setup, ephemeral agent/worktree setup, generated type refreshes, etc. But **don't use it as the backend half of normal local-local development**: a local Convex backend is a subprocess of `convex dev`, and when the command exits, the local backend exits too. ([Convex](https://docs.convex.dev/cli/local-deployments?utm_source=chatgpt.com))

### Local deployment vs cloud dev deployment

I use **local Convex** when I want fast isolated development or an ephemeral worktree:

```bash
npx convex deployment select local
npx convex dev
```

Advantages are local state, fast sync, no cloud database/function bandwidth quota consumption, and no account requirement. State lives under `.convex`. Limitations: the backend only lives while `convex dev` runs, doesn't have a publicly reachable webhook URL by default, Node actions run directly on your machine, and the feature remains beta. ([Convex](https://docs.convex.dev/cli/local-deployments?utm_source=chatgpt.com))

Use your **cloud dev deployment**:

```bash
npx convex deployment select dev
```

when you need a public Convex URL, external webhooks/integrations, cloud-accessible environment defaults, or a backend other machines/services need to reach. A project normally gives each developer a personal cloud dev deployment. ([Convex](https://docs.convex.dev/cli/local-deployments?utm_source=chatgpt.com))

### Anonymous local deployments

These are now a first-class workflow. In a **non-interactive shell**, if there's no configured deployment and no `CONVEX_DEPLOY_KEY`, Convex automatically provisions an anonymous local deployment rather than prompting an agent to log in. That's particularly good for disposable AI-agent worktrees. ([Convex](https://docs.convex.dev/cli/agent-mode?utm_source=chatgpt.com))

### `.env.local`

For a Next.js project, the current working shape is:

```dotenv
# Selected dev deployment
CONVEX_DEPLOYMENT=dev:some-name
# or the local-deployment form

# WebSocket/client/function URL
NEXT_PUBLIC_CONVEX_URL=https://some-name.convex.cloud

# HTTP Actions URL
NEXT_PUBLIC_CONVEX_SITE_URL=https://some-name.convex.site
```

For a local backend these become approximately:

```dotenv
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210
NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211
```

`CONVEX_DEPLOYMENT` selects what the CLI itself targets; `NEXT_PUBLIC_CONVEX_URL` is what `ConvexReactClient` and `convex/nextjs` use; `NEXT_PUBLIC_CONVEX_SITE_URL` is the `.site` HTTP Actions endpoint. Convex's general project-config docs explicitly guarantee writing the deployment selector and framework-specific client URL, while current Next-oriented Convex integration docs/examples also show the CLI-created `.env.local` containing the `.site` URL. ([Convex](https://docs.convex.dev/production/project-configuration?utm_source=chatgpt.com))

So I would **keep all three CLI-managed** and not hard-code them into `package.json` or `next.config.ts`.

---

# 4. `convex.json` in 1.45

The exact 1.45 schema is worth using because some old blog posts mention properties that simply don't exist anymore. Notably, **`authInfo` is not a valid 1.45 `convex.json` property**. Authentication providers now belong in `convex/auth.config.ts`. The 1.45 schema has `additionalProperties: false`. ([UNPKG](https://app.unpkg.com/convex%401.45.0/files/schemas/convex.schema.json))

For this stack I would start with:

```json
{
  "$schema": "./node_modules/convex/schemas/convex.schema.json",

  "functions": "convex/",

  "node": {
    "nodeVersion": "22"
  },

  "generateCommonJSApi": false,

  "codegen": {
    "fileType": "ts",
    "legacyComponentApi": false,
    "staticApi": false,
    "staticDataModel": false
  },

  "aiFiles": {
    "enabled": true,
    "skills": {
      "agents": ["codex"]
    }
  }
}
```

Here is how I'd treat every relevant 1.45 knob:

| Setting | Recommendation | Reason |
|---|---|---|
| `$schema` | Set it | IDE validation/completion |
| `functions` | `"convex/"` / omit | Standard layout; only change for real repo-layout reasons |
| `node.externalPackages` | **Omit by default** | Only externalize packages that cannot be bundled / require runtime installation or binaries |
| `node.nodeVersion` | `"22"` | Conservative explicit target with broad package compatibility; 1.45 supports 20/22/24 |
| `generateCommonJSApi` | `false` | Next 16/modern TS uses ESM; turn on only for actual `require()` consumers |
| `codegen.fileType` | `"ts"` | 1.45 schema calls this recommended for TypeScript projects |
| `codegen.legacyComponentApi` | `false` | Current recommended/default component API generation |
| `codegen.staticApi` | `false` initially | Beta optimization for very large projects; enable only if generated API typing becomes a TS/editor bottleneck |
| `codegen.staticDataModel` | `false` initially | Same reasoning |
| `aiFiles.enabled` | `true` if agents are part of workflow | Turn off if you don't want generated AI guidance/skills |
| `aiFiles.skills.agents` | Only agents you actually use | e.g. `["codex"]`, `["claude-code","codex"]` |
| `aiFiles.disableStalenessMessage` | Omit | Deprecated |
| `bundler.includeSourcesContent` | Omit | Deprecated |
| `typescriptCompiler` | Omit | Deprecated; TypeScript 7 handles native compiler selection |
| `authKit` | Omit | This is for **WorkOS AuthKit**, not Clerk |
| `authInfo` | **Do not set** | Not part of the 1.45 schema |

Those supported properties/defaults come straight from the packaged 1.45 JSON schema; it supports Node `20`, `22`, and `24`, says `fileType: "ts"` is recommended for TS projects, and marks `bundler.includeSourcesContent`, `typescriptCompiler`, and `aiFiles.disableStalenessMessage` deprecated. ([UNPKG](https://app.unpkg.com/convex%401.45.0/files/schemas/convex.schema.json))

One caveat around `externalPackages`: I would not cargo-cult `"*"` into a Next/Convex app. Externalization is an escape hatch for packages that cannot be bundled or need to be installed directly in the Node action environment. Keep Convex's normal bundling unless an actual dependency forces you out of it. ([UNPKG](https://app.unpkg.com/convex%401.45.0/files/schemas/convex.schema.json))

And your Clerk auth remains separate:

```ts
// convex/auth.config.ts
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

---

# 5. Vercel deployment

Yes: use the build command you quoted:

```bash
npx convex deploy \
  --cmd 'next build' \
  --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
```

If the repo is Bun-first:

```bash
bun x convex deploy \
  --cmd 'bun x next build' \
  --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
```

The important property of this pattern is that **Convex determines the target deployment from `CONVEX_DEPLOY_KEY`, supplies that deployment's URL to the frontend build command, then deploys backend code and builds the corresponding frontend together**. `--cmd-url-env-var-name` lets you explicitly make that temporary build-time variable `NEXT_PUBLIC_CONVEX_URL`. ([Convex](https://docs.convex.dev/cli/reference/deploy?utm_source=chatgpt.com))

For Vercel:

```text
Vercel Production environment
  CONVEX_DEPLOY_KEY = production Convex deploy key

Vercel Preview environment
  CONVEX_DEPLOY_KEY = Convex preview deploy key

Vercel Development
  no production deploy key
```

**Never put the production deploy key into Preview or Development.**

Convex's Vercel guide explicitly recommends a production key scoped to Vercel's Production environment and a separate Preview Deploy Key scoped only to Preview. A preview key creates/reuses a fresh branch-associated Convex preview backend, leaving both production and developers' dev deployments untouched. ([Convex](https://docs.convex.dev/production/hosting/vercel?utm_source=chatgpt.com))

For the production key, grant the minimum required permission—currently `deployment:deploy` for this deployment workflow. `CONVEX_DEPLOY_KEY` is a secret and must never be exposed through a `NEXT_PUBLIC_*` variable. ([Convex](https://docs.convex.dev/production/hosting/vercel?utm_source=chatgpt.com))

For preview deployments, remember that each backend starts with separate data and environment. Convex supports **project default environment variables** for preview deployments and `--preview-run` for optional initialization/seed work. ([Convex](https://docs.convex.dev/production/hosting/vercel?utm_source=chatgpt.com))

In this Clerk setup, one of the preview defaults you need to think about is:

```text
CLERK_JWT_ISSUER_DOMAIN
```

Every preview Convex deployment needs an issuer configuration that corresponds to the Clerk environment you're using. Don't accidentally build a preview frontend with test Clerk credentials while its Convex backend is configured to trust the production Clerk issuer, or vice versa.

One extra safety pattern I like is to regard production as inaccessible to normal development tooling. The current Convex tooling itself increasingly follows this philosophy—for example, its MCP server blocks production by default unless explicitly enabled. ([Convex](https://docs.convex.dev/cli/reference/mcp?utm_source=chatgpt.com))

---

# 6. React Query adapter and `convex-helpers`

## `@convex-dev/react-query`

For **this stack, use plain Convex hooks by default**.

I would use:

```ts
useQuery
useMutation
useAction
usePaginatedQuery

preloadQuery
usePreloadedQuery
```

and not add TanStack Query just for Convex.

Convex already gives you the most important thing TanStack Query normally has to manufacture: a coherent reactive subscription. The adapter therefore sets Convex queries to effectively never become stale and updates TanStack Query when the Convex subscription pushes a new value—there is no normal polling/invalidation cycle. ([GitHub](https://github.com/get-convex/convex-react-query?utm_source=chatgpt.com))

The adapter is worthwhile if your app **already uses TanStack Query extensively** and you have a strong architectural reason to put Convex, REST calls, third-party APIs, ordinary promises, and actions behind one TanStack query abstraction.

I would not choose it for a fresh Convex-centric Next app today because it adds another provider/cache/lifecycle abstraction, pagination remains less natural than Convex's native API, and the repository still has open 2026 issues around SSR/auth hydration and paginated/infinite queries. ([GitHub](https://github.com/get-convex/convex-react-query/issues?utm_source=chatgpt.com))

So:

```text
Convex-centric application
→ plain Convex hooks

Existing large TanStack Query application adopting Convex
→ adapter can be justified
```

## `convex-helpers`

`convex-helpers` is still useful, but I wouldn't install it and start importing everything. Its current package covers custom function builders, relationship helpers, sessions, validation, RLS, migrations, rate limiting, retries, query streams, CORS, triggers, Zod support and more. ([GitHub](https://github.com/get-convex/convex-helpers?utm_source=chatgpt.com))

The parts I still like are:

**`customFunctions`** for building `authenticatedQuery`, `authenticatedMutation`, organization-aware contexts, shared authorization checks, or enriching `ctx`. There is still no equivalent one-line core feature that replaces this pattern. ([GitHub](https://github.com/get-convex/convex-helpers/blob/main/packages/convex-helpers/server/customFunctions.ts?utm_source=chatgpt.com))

```ts
export const authedQuery = customQuery(
  query,
  customCtx(async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new Error("Unauthenticated");
    }

    return { identity };
  }),
);
```

**Relationship helpers** can remain a nice ergonomic layer for repeated indexed one-to-one/one-to-many lookups. They don't change Convex's underlying data model or performance rules; they're just useful boilerplate reduction. ([GitHub](https://github.com/get-convex/convex-helpers/blob/main/packages/convex-helpers/README.md?utm_source=chatgpt.com))

**Validator utilities / Standard Schema / Zod integration** remain reasonable when you actually need richer validation than Convex `v.*`, especially transformations/refinements or sharing external schemas. For ordinary function args and DB schemas, use core `v` and don't introduce Zod solely because it's familiar. ([GitHub](https://github.com/get-convex/convex-helpers/blob/main/packages/convex-helpers/server/zod4.ts?utm_source=chatgpt.com))

I would *not* reach for older helper implementations when a dedicated modern Convex Component now owns the problem:

```text
Long-running migrations
→ @convex-dev/migrations

Rate limiting
→ @convex-dev/rate-limiter

Action retries / durable work
→ @convex-dev/action-retrier or Workflow component

Simple pagination
→ core Convex pagination/usePaginatedQuery
```

Convex's own database docs now point to the Migrations component for production migrations; current docs use the Rate Limiter component; and Convex has a dedicated Action Retrier plus Workflow component for durable/retriable work. ([Convex](https://docs.convex.dev/database/writing-data?utm_source=chatgpt.com))

That distinction matters because many `convex-helpers` utilities predate Convex Components. They're not suddenly broken, but some have become **legacy implementation choices rather than the preferred platform abstraction**.

---

## The configuration I would actually ship

In condensed form:

```text
Client:
ClerkProvider
  └─ ConvexProviderWithClerk

Auth:
Clerk native Convex integration
  + convex/auth.config.ts
  + applicationID: "convex"
  + auth().getToken()
  + NO Clerk JWT template

RSC with continued reactivity:
preloadQuery → usePreloadedQuery

Pure server read:
fetchQuery

Server write:
fetchMutation / fetchAction

Next cache:
authenticated Convex → uncached/request-time + Suspense
public deliberately-stale data → optionally "use cache"

Dev:
convex dev --start 'next dev'

Local backend:
best for isolation/speed
cloud dev:
best when external services need a public backend

Production:
production deploy key only in Vercel Production

Preview:
preview deploy key only in Vercel Preview

React state:
native Convex hooks

Helpers:
customFunctions/validators/relationships selectively;
prefer Components for migrations/rate limiting/retries
```

The two pieces of old guidance I would actively remove during a 2026 code review are **`getToken({ template: "convex" })` for a newly configured Clerk app** and **`convexAuthNextjsToken()` in a Clerk app**. Both belong to different/older auth paths than the current native Clerk→Convex integration. ([Clerk](https://clerk.com/docs/guides/development/integrations/databases/convex?utm_source=chatgpt.com))

I can also monitor the Convex/Next.js/Clerk release notes and notify you if any of these integration recommendations materially change.
