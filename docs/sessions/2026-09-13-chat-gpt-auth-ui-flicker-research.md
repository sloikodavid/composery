# Auth UI Flicker Research

Source: https://chatgpt.com/share/6aa6a19f-1504-83eb-af5b-ef6bfb94bf2e

---

## Turn 1: User

_2026-09-13T13:03:28.469Z_

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



  Research how to present auth-dependent UI without flicker or
  layout shift using Clerk 7.9 (hosted Account Portal) + Convex 1.45
  (`ConvexProviderWithClerk`) in Next.js 16.3.
  1. The readiness gap: Clerk can report signed in before Convex has
  fetched and validated its token. What exactly do
  `useConvexAuth()` `isLoading` / `isAuthenticated` go through on
  first load, on token refresh, after returning from the Account
  Portal, and after sign-out? Cite the convex/react and
  convex/react-clerk source.
  2. What should render during `AuthLoading` on a page that must not
  shift layout and must not show skeleton animations or spinners?
  Show concrete patterns (reserved geometry, rendering both states
  in identical boxes, server hints).
  3. Sign-in/out entry points without Clerk UI components:
  `useClerk().redirectToSignIn()`, `redirectToUserProfile()`,
  `signOut({ redirectUrl })`. How do return URLs (`redirect_url`),
  fallback vs force redirect env vars, and the dev instance
  `default-redirect` behave? What differs between development and
  production instances (custom domains, cookies, handshake)?
  4. Multi-tab behavior and session expiry (7-day fixed on free
  plan): what the user sees and how Convex subscriptions react when
  the token expires or the user is deleted.
  5. Security: which checks belong in Convex functions
  (`ctx.auth.getUserIdentity()`), which in the proxy, and why UI
  gating is never authorization.

---

## Turn 2: ChatGPT

_2026-09-13T13:03:30.308Z_

I’ll trace this from the exact package versions and official source, then separate observed/guaranteed behavior from the UI policy I’d recommend. I’ll pay particular attention to the Convex auth state machine, Clerk redirect semantics, and the places where development-instance behavior diverges from production.

---

## Turn 3: ChatGPT

_2026-09-13T13:03:41.532Z_

One important wrinkle is already visible in Convex’s current source/issues: the helper states distinguish initial auth loading from a later “refreshing” state, and there are recent auth-refresh bugs reported around the provider callback. I’m checking whether those are present in **1.45.0 specifically** before treating them as applicable to your stack.

---

## Turn 4: ChatGPT

_2026-09-13T13:04:42.828Z_

The package versions are real and current: `convex@1.45.0`, `@clerk/nextjs@7.9.2`, and `next@16.3.5` are all published. Convex moved the package’s repository metadata to `get-convex/convex-backend`, so I’m treating stale `convex-js` pages only as corroboration unless I can pin the code to the 1.45.0 release.

---

## Turn 5: ChatGPT

_2026-09-13T13:11:56.926Z_

## Bottom line

For this stack, **Clerk’s signed-in state is not the state you should use to reveal Convex-authenticated UI**. In `convex@1.45.0`, `ConvexProviderWithClerk` first observes Clerk, obtains a Clerk token, sends it through `ConvexReactClient`, and waits for the Convex server to confirm that token. Until that confirmation, `useConvexAuth()` deliberately stays `{ isLoading: true, isAuthenticated: false }`. Convex’s own Clerk guide says to use `useConvexAuth()`, not Clerk’s `useAuth()`, for UI that depends on being authenticated to Convex. ([Convex](https://docs.convex.dev/auth/clerk?utm_source=chatgpt.com))  

Pinned exact-version sources: [Convex 1.45.0 ConvexProviderWithClerk.tsx](https://github.com/get-convex/convex-backend/blob/9ff6a477a42d75c30bf4e0efc1657d749a225cc7/npm-packages/convex/src/react-clerk/ConvexProviderWithClerk.tsx?utm_source=chatgpt.com) · [ConvexAuthState.tsx](https://github.com/get-convex/convex-backend/blob/9ff6a477a42d75c30bf4e0efc1657d749a225cc7/npm-packages/convex/src/react/ConvexAuthState.tsx?utm_source=chatgpt.com) · [authentication_manager.ts](https://github.com/get-convex/convex-backend/blob/9ff6a477a42d75c30bf4e0efc1657d749a225cc7/npm-packages/convex/src/browser/sync/authentication_manager.ts?utm_source=chatgpt.com) · [Clerk 7.9.2 core clerk.ts](https://github.com/clerk/javascript/blob/ed4e84dd90760f61272eb5204bb277fe7c1e1606/packages/clerk-js/src/core/clerk.ts?utm_source=chatgpt.com) · [Clerk 7.9.2 redirect resolution](https://github.com/clerk/javascript/blob/ed4e84dd90760f61272eb5204bb277fe7c1e1606/packages/shared/src/internal/clerk-js/redirectUrls.ts?utm_source=chatgpt.com). Clerk's package file at that commit identifies `@clerk/nextjs` as `7.9.2`. 

---

# 1. The Clerk → Convex readiness gap

### Framework guarantee

The Clerk adapter in **Convex 1.45.0** maps Clerk to Convex as follows:

- Convex provider loading = `!clerk.isLoaded`.
- Provider authenticated = `clerk.isSignedIn ?? false`.
- With the native Clerk integration, if `sessionClaims.aud === "convex"`, token acquisition is `getToken({ skipCache })`; it does **not** ask for the old `"convex"` JWT template.
- `orgId`, `orgRole`, and importantly `sessionId` are dependencies of the token fetch callback, so a session replacement causes the Convex auth effect to be rebuilt. That `sessionId` dependency is the fix for the earlier session-change bug noted in the Convex changelog. 

Convex then maintains a separate `isConvexAuthenticated: boolean | null`. `null` means Convex has not yet resolved server-side auth. `useConvexAuth().isLoading` is literally `isConvexAuthenticated === null`; `isAuthenticated` is true only when the upstream provider says authenticated **and** the Convex server has confirmed the token. 

The resulting state machine is:

| Situation | What `useConvexAuth()` does |
|---|---|
| **Cold load, Clerk still loading** | `isLoading=true`, `isAuthenticated=false`. Convex has no confirmed state yet.   |
| **Cold load, Clerk resolves signed out** | Convex moves directly to `isLoading=false`, `isAuthenticated=false`; no authenticated `setAuth()` sequence is required.  |
| **Cold load, Clerk resolves signed in** | There is an intentional gap: Clerk may already say signed in while Convex remains `isLoading=true`, `isAuthenticated=false`. `setAuth()` pauses the socket, fetches a token, sends `Authenticate`, and waits for a server transition confirming it. Only then does `isAuthenticated=true`.   |
| **Routine token rotation** | It does **not** turn `isLoading` back on, and does **not** set `isRefreshing`. The already-confirmed authenticated state is retained while the new token is fetched/confirmed.   |
| **Server rejects a previously confirmed token** | `isAuthenticated` stays true while `isRefreshing=true`; Convex stops/pauses the socket and force-fetches a replacement token. Successful confirmation clears `isRefreshing`.   |
| **Refresh cannot produce a token** | Convex clears its auth and reports `isAuthenticated=false`.  |
| **Sign-out** | Once Clerk is loaded and reports signed out, Convex sets its React auth state false. Its final cleanup calls `clearAuth()` only after sibling components have had an opportunity to unsubscribe, specifically to avoid authenticated queries rerunning unauthenticated during normal gated teardown.   |
| **Session ID changes while still signed in** | `fetchAccessToken` gets a new identity, the old auth is cleared, and Convex returns to the loading/validation path for the new auth context.   |

There is one subtle extra step on initial authentication. The 1.45 client option `initialAuthTokenReuse` defaults to **false** and is marked experimental. Therefore, after the first cached token is confirmed, the default client immediately asks for a fresh token and authenticates that too. Crucially, Convex reports authenticated after the cached token has been confirmed; the second routine rotation does not put the UI back into loading.  

The exact helper implementations follow those semantics: `<Authenticated>` renders only after `!isLoading && isAuthenticated`; `<Unauthenticated>` waits until loading is over; `<AuthLoading>` renders only during `isLoading`; `<AuthRefreshing>` is a separate state and only renders while still authenticated. 

### Returning from the hosted Account Portal

For sign-in, the Account Portal navigates back to your application with an active Clerk session. From Convex's perspective this is a **new page boot**, so it runs the same Clerk → token fetch → Convex server confirmation sequence above. Clerk's own under-the-hood description explicitly lists those steps and says `useConvexAuth()` becomes authenticated only after the backend validates the token. ([Clerk](https://clerk.com/docs/guides/account-portal/getting-started?utm_source=chatgpt.com))

The same practical rule applies when returning from the hosted user profile: do not assume that “Clerk already has a user” means authenticated Convex queries can mount. Use the Convex state.

### Recommendation

Treat only these as primary application phases:

`loading → authenticated | unauthenticated`

and treat `refreshing` as an overlay/substate of **authenticated**, not as another page state. Do not replace a successfully rendered signed-in app with an auth-loading screen during `isRefreshing`; Convex intentionally preserves authenticated state for that case. 

---

# 2. What should render during `AuthLoading` with zero avoidable CLS?

### Framework guarantee

Convex guarantees state selection, not presentation. `<AuthLoading>` itself merely renders its children while `isLoading`; it reserves no dimensions for you. 

### Recommendation

For this product shape, I would **not render a loading indicator at all**. Render the final geometry before auth resolves.

For a header control, give all four practical states—loading, signed out, signed in, degraded—the exact same containing box. A disabled neutral `"Account"` control during loading works better than a blank skeleton because it is static, has final dimensions, and does not pretend the user is signed in or out.

For a large `/` content switch, create one stable `main` region whose minimum block size is derived from the larger of your signed-in and signed-out initial layouts. Keep shared header/nav/hero geometry outside the switch. If content exists *below* the changing region, its initial Y position must be determined by that reserved size; otherwise the auth transition can still move it.

For authenticated queries themselves, mount the query-owning component only in the authenticated branch. Convex explicitly recommends putting auth-required `useQuery()` calls below `<Authenticated>` because otherwise a query can execute before Convex has authenticated and `ctx.auth.getUserIdentity()` can be `null`. ([Convex](https://docs.convex.dev/auth/clerk?utm_source=chatgpt.com))

A useful fourth state is **degraded auth**:

> Clerk is loaded and still says signed in, but Convex has finished loading and says unauthenticated.

That is different from an ordinary signed-out user and should not immediately flash a “Sign in” CTA. Render the same reserved box with a non-animated “Reconnect”/error treatment instead. This is especially valuable because the exact 1.45 adapter catches a `getToken()` exception and turns it into `null`, while the auth manager treats a null refresh as authentication failure.  

### Server hints

Clerk `auth()` is available in App Router Server Components and tells you what Clerk saw on the incoming request. It can therefore be a *presentation hint*—for example, deciding whether your same-sized neutral frame says “Account” versus nothing—but it does **not** eliminate the Convex readiness step. ([Clerk](https://clerk.com/docs/reference/nextjs/app-router/auth?utm_source=chatgpt.com))

I would **not** call `auth()` in the root `/` page solely to solve this flicker. Your home page is SEO-sensitive/public, and request-cookie access is a Next.js Dynamic API; with your current non-Cache-Components model, request-dependent auth makes that rendering path dynamic. ([Next.js](https://nextjs.org/docs/app/api-reference/functions/cookies?utm_source=chatgpt.com))

If `/` later becomes request-dynamic for some independent reason, then a Clerk server hint becomes cheap and reasonable—but still only as a hint. The protected Convex subtree waits for `useConvexAuth()`.

---

# 3. Hosted Account Portal redirects and entry points

### Exact 7.9.2 client behavior

`redirectToSignIn(options)` calls `navigate(buildSignInUrl(options))`. `redirectToUserProfile()` takes **no options** in the 7.9.2 source and navigates to `buildUserProfileUrl()`. `signOut({ redirectUrl })` is the documented programmatic sign-out form.  ([Clerk](https://clerk.com/docs/guides/development/custom-flows/authentication/sign-out?utm_source=chatgpt.com))

For sign-in redirects, Clerk 7.9.2's redirect resolver has an exact priority:

**force redirect → `redirect_url` → fallback redirect → `/`**. A force URL therefore deliberately destroys “return me where I came from” semantics. 

And `@clerk/nextjs@7.9.2` wires the Next environment variables into those provider options:

`NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL`, `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`, and `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL`. 

### Recommendation for your app

Use explicit return-to-current-location on your sign-in button:

```ts
void clerk.redirectToSignIn({
  redirectUrl: window.location.href,
})
```

and **do not set a sign-in FORCE redirect**. Since `/` is already both landing page and app, the sensible global fallback is simply `/`.

If users can move from sign-in to sign-up inside the Account Portal, configure the equivalent sign-up fallback as well. Clerk explicitly recommends defining corresponding sign-in and sign-up redirect settings together. ([Clerk](https://clerk.com/docs/guides/development/clerk-environment-variables?utm_source=chatgpt.com))

For profile:

```ts
void clerk.redirectToUserProfile()
```

There is no `redirectUrl` parameter on that method in the exact 7.9.2 implementation. If you require a deterministic page-specific return after profile management, Clerk's hosted Account Portal supports direct links of the form `.../user?redirect_url=...`; the destination must be on the instance domain/subdomain or same origin as the requester.  ([Clerk](https://clerk.com/docs/guides/account-portal/direct-links?utm_source=chatgpt.com))

For sign-out:

```ts
void clerk.signOut({ redirectUrl: "/" })
```

That explicitly returns to the public/signed-out form of the same home route. ([Clerk](https://clerk.com/docs/guides/development/custom-flows/authentication/sign-out?utm_source=chatgpt.com))

### Direct Account Portal visits are different

If somebody visits the hosted Account Portal directly, there may be no `redirect_url` generated by your application. Clerk's current Account Portal contract says to either include `redirect_url` in the link or configure the Portal's own fallback redirects under **Account Portal → Redirects**. Those hosted-Portal fallback settings are distinct from your self-hosted/app SDK redirect configuration. ([Clerk](https://clerk.com/docs/guides/account-portal/direct-links?utm_source=chatgpt.com))

### `accounts/.../default-redirect`

**UNVERIFIED as a supported contract.** The exact Clerk 7.9.2 repository contains an integration-test comment describing direct development-Account-Portal sign-in landing at `accounts/default-redirect`, but that test is a TODO, and Clerk's public Account Portal documentation does not expose `default-redirect` as an API you should depend on. 

So: never route application logic around `/default-redirect`. Supply `redirect_url` or configure the Portal fallback.

### Development vs production

This distinction is material:

| Development instance | Production instance |
|---|---|
| Account Portal is on an `accounts.dev` domain. Clerk dynamically records your localhost “home origin.” ([Clerk](https://clerk.com/docs/guides/account-portal/getting-started?utm_source=chatgpt.com)) | Hosted Account Portal is normally `accounts.<your-domain>`, and the Clerk Frontend API is on your production-domain setup. ([Clerk](https://clerk.com/docs/guides/account-portal/getting-started?utm_source=chatgpt.com)) |
| Because localhost and Clerk are cross-site, Clerk uses a “dev browser” value transported in `__clerk_db_jwt` query data to maintain the long session. ([Clerk](https://clerk.com/docs/guides/development/managing-environments?utm_source=chatgpt.com)) | FAPI can use the long-lived HttpOnly `__client` cookie on the same site. `__clerk_db_jwt` is not used in production. ([Clerk](https://clerk.com/docs/guides/development/managing-environments?utm_source=chatgpt.com)) |
| `buildUrlWithAuth()` decorates URLs as needed for the development auth model. ([Clerk](https://clerk.com/docs/js-frontend/reference/objects/clerk?utm_source=chatgpt.com)) | Normal same-site cookie/session architecture applies. ([Clerk](https://clerk.com/docs/guides/development/managing-environments?utm_source=chatgpt.com)) |

Clerk separately has the short-lived `__session` JWT used to authenticate requests; when that JWT is no longer usable, Clerk's longer-lived session machinery can obtain a fresh one. The 7-day maximum is the **session maximum lifetime**, not the lifetime of each individual JWT. ([Clerk](https://clerk.com/docs/guides/development/sdk-development/terminology?utm_source=chatgpt.com))

---

# 4. Multi-tab behavior, 7-day expiry, token expiry, deletion

### Multi-tab sign-out

This one is verifiable down to Clerk 7.9.2 source. If `BroadcastChannel` exists, Clerk creates a channel named `"clerk"`. A `UserSignOut` event posts `{ type: "signout" }`; other tabs receiving that message call `handleUnauthenticated({ broadcast: false })`. 

Each affected tab's Clerk auth therefore changes, which feeds its own `ConvexProviderWithClerk`. Protected Convex-query components should consequently unmount under the authenticated gate, and Convex's effect ordering is intentionally designed so those subscriptions unsubscribe before `clearAuth()` runs. 

**UNVERIFIED:** I did not find an exact-7.9.2 guarantee for equivalent instant cross-tab sign-out in a browser where `BroadcastChannel` is unavailable. The source explicitly guards use of the API, so don't make sub-second cross-tab revocation a security assumption.

### Routine token expiration

Convex reads the JWT's `iat`/`exp` and schedules refresh before expiration; its default auth refresh leeway is 10 seconds. An active client is intended to renew before the token actually expires.  

If the server nevertheless rejects the current token, Convex enters `isRefreshing`, pauses/stops the socket, and force-fetches a token. During that recovery, `isAuthenticated` remains true. If a replacement succeeds, the UI can stay where it is; if it fails, Convex becomes unauthenticated. 

So do **not** show a page loader on routine token renewal. At most set `aria-busy` or temporarily disable a mutation button while `isRefreshing`; keep the last successfully rendered layout and data visible.

### Seven-day Clerk maximum

Clerk documents maximum lifetime as “session expires and user has to sign in again regardless of activity”; newly created instances default to 7 days, and custom production lifetimes require a paid plan. ([Clerk](https://clerk.com/docs/guides/secure/session-options?utm_source=chatgpt.com))

When that long-lived Clerk session can no longer issue a usable token, Convex's token fetch eventually cannot maintain authentication and moves to false. At that point your stable home shell should switch from authenticated app content to the signed-out funnel without altering shared page geometry.  

### If a Clerk user is deleted

**UNVERIFIED for immediate session invalidation in Clerk 7.9.2.** Clerk's `deleteUser()` documentation promises that the user is deleted, but does not say that all active sessions are synchronously revoked. That omission is meaningful because Clerk explicitly says `banUser()` revokes all sessions and `revokeSession()` signs the associated client out. ([Clerk](https://clerk.com/docs/reference/backend/user/delete-user?utm_source=chatgpt.com))

Do not therefore make “user no longer exists in Clerk” depend only on when an already-issued JWT disappears from the browser.

Convex's documented pattern is stronger: maintain a local user record keyed by the Clerk `subject`, consume `user.deleted` via a Clerk webhook, and make your protected functions require both a valid `ctx.auth` identity **and** an active local user record. Convex's own Clerk database example demonstrates `deleteFromClerk` plus `getCurrentUser()` looking up the JWT subject in the local users table. ([Convex](https://docs.convex.dev/auth/database-auth?utm_source=chatgpt.com))

If “administrator disables this account now” must take effect immediately, my recommendation is to set a `disabledAt`/status field in Convex as part of your own administrative transaction before or alongside the Clerk revoke/delete operation. A webhook is synchronization, not an instantaneous authorization primitive.

### A Convex 1.45.0 auth-recovery risk

There is also an open Convex issue filed against an earlier 1.42.3 client: when the server rejects a token and `forceRefreshToken` returns the **same** token string, the reauthentication branch treats it as failure and can leave Convex unauthenticated until a remount/reconfiguration. The relevant destructive branch is still present in the exact 1.45.0 `authentication_manager.ts`. ([GitHub](https://github.com/get-convex/convex-js/issues/184?utm_source=chatgpt.com)) 

This is not evidence that Clerk will routinely hit that condition—Clerk's `skipCache: true` is intended to refresh—but it is a reason to have the “Clerk signed in / Convex unauthenticated” degraded state rather than turning it visually into an ordinary logged-out state.

---

# 5. Security boundary

### Framework guarantees

Convex states that `ctx.auth.getUserIdentity()` returns the identity associated with a valid authenticated client and `null` for an unauthenticated normal query/mutation/action. Its best-practices guide says protected public functions must perform access-control checks and must not trust spoofable client arguments such as email as authorization. ([Convex](https://docs.convex.dev/auth/functions-auth?utm_source=chatgpt.com))

Clerk's current Next.js guidance likewise says Proxy/Middleware is **not the best place to protect resources** and recommends protecting access at the code that reads or mutates the resource. `clerkMiddleware()` itself protects no routes unless you opt in. ([Clerk](https://clerk.com/docs/reference/nextjs/clerk-middleware?utm_source=chatgpt.com))

That maps especially cleanly to your architecture because browser Convex RPC goes to Convex, not through your Next.js `src/proxy.ts`.

### Recommendation

Use each layer for a different job:

- **UI gating:** prevents confusing UI and prevents auth-required subscriptions from starting too early. It is UX, not authorization.
- **`src/proxy.ts`:** initialize Clerk for Next requests, perform coarse navigation behavior only where useful, and support `auth()` in Next resources. Do not put your core product authorization policy there.
- **Next Route Handlers / Server Actions:** if you have any, authenticate them individually with Clerk because they are separate server resources. Clerk explicitly recommends every protected resource enforce its own check. ([Clerk](https://clerk.com/docs/nextjs/guides/secure/protect-content?utm_source=chatgpt.com))
- **Convex public functions:** authoritative check for Convex data: identity plus resource-level membership/ownership/status on every protected function. ([Convex](https://docs.convex.dev/understanding/best-practices?utm_source=chatgpt.com))

An attacker can call a public Convex function without rendering your React tree or visiting your Next.js page, which is exactly why hiding a button or wrapping a component in `<Authenticated>` can never authorize a mutation.

---

# 1) Recommended policy to adopt

1. **Convex decides auth-ready UI.** Never reveal Convex-authenticated UI from Clerk `isSignedIn` alone.
2. **`AuthLoading` reserves geometry; it does not show activity.** No spinner, shimmer, skeleton animation, or alternate-height page.
3. **`AuthRefreshing` preserves signed-in UI.** Keep the successful screen mounted.
4. **Protected `useQuery()` components only mount after Convex authentication.**
5. **Treat `Clerk signed in + Convex unauthenticated` as degraded auth, not signed out.**
6. **Sign-in carries an explicit `redirectUrl`; do not configure FORCE redirects unless intentionally discarding return context.**
7. **Use `/` as sign-in/sign-up fallback and sign-out destination.**
8. **Never depend on Account Portal `/default-redirect`.**
9. **Proxy is routing/session plumbing, not the Convex authorization boundary.**
10. **Every protected Convex function checks identity and resource authorization.**
11. **Deletion/disable status lives in Convex too if revocation timing matters.**
12. **Keep Convex 1.45 experimental `initialAuthTokenReuse` and `expectAuth` off until you have a measured reason to enable them.** They are explicitly experimental in the exact client source. 

# 2) Concrete code shapes

### Providers

```tsx
// src/components/providers/convex-provider.tsx
"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import type { ReactNode } from "react";

const convex = new ConvexReactClient(
  process.env.NEXT_PUBLIC_CONVEX_URL!,
  {
    // Keep the Convex 1.45 defaults:
    // expectAuth: false,
    // initialAuthTokenReuse: false,
  },
);

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

That provider shape is Convex's documented Clerk/Next pattern. ([Convex](https://docs.convex.dev/auth/clerk?utm_source=chatgpt.com))

Your native integration remains:

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

`applicationID: "convex"` corresponds to the JWT audience Convex validates. ([Convex](https://docs.convex.dev/auth/clerk?utm_source=chatgpt.com))

### Stable, no-CLS auth UI

```tsx
"use client";

import { useAuth as useClerkAuth, useClerk } from "@clerk/nextjs";
import { useConvexAuth } from "convex/react";

export function AccountControl() {
  const clerkAuth = useClerkAuth();
  const clerk = useClerk();
  const convex = useConvexAuth();

  const phase =
    !clerkAuth.isLoaded || convex.isLoading
      ? "loading"
      : convex.isAuthenticated
        ? "authenticated"
        : clerkAuth.isSignedIn
          ? "degraded"
          : "unauthenticated";

  return (
    <div className="h-9 w-28">
      {phase === "loading" && (
        <button
          type="button"
          disabled
          aria-busy="true"
          className="h-9 w-28"
        >
          Account
        </button>
      )}

      {phase === "authenticated" && (
        <button
          type="button"
          className="h-9 w-28"
          aria-busy={convex.isRefreshing || undefined}
          onClick={() => void clerk.redirectToUserProfile()}
        >
          Account
        </button>
      )}

      {phase === "unauthenticated" && (
        <button
          type="button"
          className="h-9 w-28"
          onClick={() =>
            void clerk.redirectToSignIn({
              redirectUrl: window.location.href,
            })
          }
        >
          Sign in
        </button>
      )}

      {phase === "degraded" && (
        <button
          type="button"
          className="h-9 w-28"
          onClick={() => window.location.reload()}
        >
          Reconnect
        </button>
      )}
    </div>
  );
}
```

The use of Clerk state here is only to distinguish “genuinely signed out” from “Clerk still has a session but Convex authentication failed.” It is **not** used to authorize Convex content.

For your large root region:

```tsx
export function HomeAuthRegion() {
  const { isLoading, isAuthenticated } = useConvexAuth();

  return (
    <main className="min-h-[var(--home-initial-region-height)]">
      {isLoading ? (
        <HomeNeutralFrame />
      ) : isAuthenticated ? (
        <SignedInApp />
      ) : (
        <SignedOutFunnel />
      )}
    </main>
  );
}
```

Set `--home-initial-region-height` from your actual largest initial design state rather than guessing it. `SignedInApp` is where authenticated `useQuery()` calls live.

If a route is *already dynamic* for another reason, a server hint can be passed down:

```tsx
// Server Component — not recommended merely for auth on your public "/".
import { auth } from "@clerk/nextjs/server";

export default async function Page() {
  const { isAuthenticated } = await auth();

  return <Home serverSignedInHint={isAuthenticated} />;
}
```

The hint may select neutral copy, but `SignedInApp` still waits for Convex. ([clerk.com](https://clerk.com/docs/reference/nextjs/app-router/auth?utm_source=chatgpt.com))

### Convex authorization

```ts
// convex/lib/auth.ts
import type { QueryCtx, MutationCtx } from "../_generated/server";

export async function requireCurrentUser(
  ctx: QueryCtx | MutationCtx,
) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new Error("Unauthenticated");
  }

  const user = await ctx.db
    .query("users")
    .withIndex("byExternalId", (q) =>
      q.eq("externalId", identity.subject),
    )
    .unique();

  if (!user || user.disabledAt) {
    throw new Error("Unauthorized");
  }

  return { identity, user };
}
```

Then every protected function also checks the requested resource:

```ts
export const getProject = query({
  args: { projectId: v.id("projects") },

  handler: async (ctx, { projectId }) => {
    const { user } = await requireCurrentUser(ctx);
    const project = await ctx.db.get(projectId);

    if (!project || project.ownerId !== user._id) {
      throw new Error("Unauthorized");
    }

    return project;
  },
});
```

This follows Convex's documented “identity plus granular access control in every protected public function” model. ([Convex](https://docs.convex.dev/understanding/best-practices?utm_source=chatgpt.com))

### Proxy

For a public `/`, keep it boring:

```ts
// src/proxy.ts
import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
```

This is the current Clerk Next 16 form; by default it does not protect routes. ([Clerk](https://clerk.com/docs/reference/nextjs/clerk-middleware?utm_source=chatgpt.com))

# 3) Trade-offs I would reject

**Gating with Clerk `isSignedIn`:** rejected because it opens the exact readiness hole Convex tells you `useConvexAuth()` exists to close. ([Convex](https://docs.convex.dev/auth/clerk?utm_source=chatgpt.com))

**Rendering nothing during auth loading:** rejected for any region whose signed-in/signed-out replacement has different dimensions; it creates avoidable CLS.

**Animated skeleton or page spinner:** rejected both by your UI constraint and because auth validation normally needs only a stable transitional geometry, not a separate visual mode.

**Making `/` server-auth-dependent just to pick the correct header button:** rejected because it trades a client-sized auth slot problem for request-dependent rendering of your SEO landing route. ([Next.js](https://nextjs.org/docs/app/api-reference/functions/cookies?utm_source=chatgpt.com))

**Using a FORCE sign-in redirect to `/`:** rejected because force outranks `redirect_url`, throwing away deep-link/return context. 

**Protecting everything in `src/proxy.ts`:** rejected because both Clerk's current guidance and Convex's threat model put authorization next to the protected resource. ([clerk.com](https://clerk.com/docs/reference/nextjs/clerk-middleware?utm_source=chatgpt.com))

**Turning on `expectAuth`:** rejected for a single public+private `/`; it is experimental and is specifically described as appropriate for pages that should only be viewed by authenticated clients. Your route deliberately serves anonymous users too. 

**Turning on `initialAuthTokenReuse` immediately:** rejected for now. It could eliminate the post-confirmation second Authenticate/query rerun, but 1.45 labels it experimental. Measure duplicate authenticated-query work first. 

# 4) Open risks

**User deletion:** immediate revocation of all already-active sessions is **UNVERIFIED for Clerk 7.9.2** from the published `deleteUser` contract. Keep a Convex-side active/deleted status if deletion is an authorization event. ([Clerk](https://clerk.com/docs/reference/backend/user/delete-user?utm_source=chatgpt.com))

**`default-redirect`:** **UNVERIFIED as public API**. It appears only in an exact-version TODO integration-test description; never depend on it. 

**Cross-tab environments without `BroadcastChannel`:** exact 7.9.2 source guarantees the explicit sign-out broadcast only when that browser facility exists. Alternative instantaneous propagation is **UNVERIFIED** from the inspected source. 

**Refresh recovery in Convex 1.45:** the same-token-on-reauth failure reported in the open Convex issue still matches the exact 1.45 auth-manager branch. Also, Clerk token-fetch exceptions become `null` in the Convex adapter. Your `degraded` UI state and telemetry should detect `Clerk signed in && !Convex loading && !Convex authenticated`; that state should be rare enough that its occurrence is actionable rather than silently displayed as logged out. ([GitHub](https://github.com/get-convex/convex-js/issues/184?utm_source=chatgpt.com))
