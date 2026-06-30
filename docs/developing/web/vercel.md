---
title: Vercel
description: Configure and deploy the Next.js app to Vercel Production, plus cookieless analytics.
---

You only deploy production from git (branch `main`). Local development never goes
through Vercel; it uses `pnpm run dev` with `.env.local` (see
[index](./index.md#local-development)). So Vercel only needs Production
configuration.

## Link the project

```bash
cd packages/web
vercel link
```

Project settings:

- Framework preset: Next.js.
- Install command: `pnpm install`.
- Build command:

  ```text
  npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
  ```

  It deploys [Convex](./convex.md) first, injects the correct
  `NEXT_PUBLIC_CONVEX_URL` and Convex site URL into the Next.js build, then builds
  the frontend.

- Project Settings -> Git: production branch = `main`.
- Project Settings -> Build and Deployment -> Ignored Build Step = **Only build
  production**. There is no preview Convex backend, so a non-`main` branch deploy
  has nowhere correct to point.

Plus the two project-level settings `packages/web/vercel.json` cannot encode
(covered in [index](./index.md#deploy)): **Root Directory** = `packages/web`, and
**Include source files outside of the Root Directory in the Build Step** =
Enabled, so the build can read `docs/` and the workspace manifests.

## Production environment variables

Add these Vercel Production environment variables (frontend plane):

| Variable                            | Production value                                                |
| ----------------------------------- | --------------------------------------------------------------- |
| `CONVEX_DEPLOY_KEY`                 | the `prod:` deploy key from the [Convex](./convex.md) step      |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Production [Clerk](./clerk.md) publishable key                  |
| `CLERK_SECRET_KEY`                  | Production Clerk secret key                                     |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`     | `/sign-in`                                                      |
| `CLERK_AUTHORIZED_PARTIES`          | `https://www.<website-domain>` (exact origins, comma separated) |

```bash
vercel env add CONVEX_DEPLOY_KEY production --sensitive
vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY production
vercel env add CLERK_SECRET_KEY production --sensitive
vercel env add NEXT_PUBLIC_CLERK_SIGN_IN_URL production
vercel env add CLERK_AUTHORIZED_PARTIES production
```

After changing Vercel env vars, redeploy - Vercel does not apply env changes to
old deployments. Check the `CONVEX_DEPLOY_KEY` shape before saving: it must
start with `prod:<production-deployment-name>|`. A `dev:` key or a raw
`<deployment-name>|...` admin key makes Vercel deploy to your dev backend. The
deploy log must name the production Convex URL; if it names the deployment that
local `.env.local` calls `CONVEX_DEPLOYMENT`, the wrong key was pasted.

```bash
vercel env ls production
```

## Analytics & privacy

Two planes of observability, no third-party tracker and no new env vars:

- **Web traffic & performance.** `@vercel/analytics` and `@vercel/speed-insights`
  are mounted in `app/layout.tsx`. They need no env - Vercel injects the
  `/_vercel/insights` and `/_vercel/speed-insights` endpoints at the edge. Enable
  **Web Analytics** and **Speed Insights** for the project in the Vercel
  dashboard (Project -> Analytics / Speed Insights -> Enable). They no-op off
  Vercel and only log (no beacon) in development. To surface a one-click "Open in
  Vercel" link on `/console` (the in-app pointer to those dashboards), set
  `NEXT_PUBLIC_VERCEL_PROJECT_URL` to the project's dashboard URL
  (`https://vercel.com/<team>/<project>`) in the Next env; `lib/vercel-dashboard.ts`
  reads it and the link hides when it is unset.
- **Product/fleet KPIs.** Derived on demand in `convex/staff/stats.ts`
  (`api.staff.stats.overview`) from existing tables - no separate analytics
  store, no per-pageview writes. Surfaced on `/console` (staff only). Snapshot
  tiles read per-status via the `boxes.status` index; funnel/trend numbers read a
  trailing window via the `created_at` indexes, so cost tracks recent volume, not
  total table size.

**Cookies / GDPR.** Vercel Web Analytics and Speed Insights are cookieless and
do not collect personal data, so **no consent banner is required**. The only
cookies the site sets are [Clerk](./clerk.md)'s strictly-necessary authentication
cookies, which are exempt from consent under the ePrivacy Directive. Adding any
cookie-based or cross-site tracker later would change this - add a consent banner
then, not before.

## References

- Vercel environment variables: https://vercel.com/docs/environment-variables.
- Vercel env CLI: https://vercel.com/docs/cli/env.
- Next.js environment variables: https://nextjs.org/docs/app/guides/environment-variables.
