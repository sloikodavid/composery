---
title: Vercel
description: Configure and deploy the Next.js app to Vercel Production, plus cookieless analytics.
---

You only deploy production from git (branch `main`). Local development never goes
through Vercel; it uses `pnpm run dev` with `.env.local` (see
[index](../index.md#local-development)). So Vercel only needs Production
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
  `NEXT_PUBLIC_CONVEX_URL` into the Next.js build, then builds the frontend.

- Project Settings -> Git: production branch = `main`.
- Project Settings -> Build and Deployment -> Ignored Build Step = **Only build
  production**. There is no preview Convex backend, so a non-`main` branch deploy
  has nowhere correct to point.

Plus the two project-level settings `packages/web/vercel.json` cannot encode
(covered in [index](../index.md#production-deploy)): **Root Directory** = `packages/web`, and
**Include source files outside of the Root Directory in the Build Step** =
Enabled, so the build can read `docs/` and the workspace manifests.

## Domains

Add both `composery.io` and `www.composery.io` to the project and make
`www.composery.io` canonical. Run `vercel domains inspect` for each, then
create the exact records it reports in the `composery.io` Cloudflare zone.
Cloudflare is external DNS, so do not use `vercel dns add`. Verify the apex
redirect, `www` TLS certificate, and that no `vercel.app` preview origin is
listed in `CLERK_AUTHORIZED_PARTIES`.

## Production environment variables

`packages/web/.env.example.next.prod` is the authoritative list of Vercel
Production env vars (frontend plane); add every key it lists. Most values come
from the service page that produces them ([Clerk](./clerk.md), [Polar](./polar.md),
[Hetzner](./hetzner.md)), and the `NEXT_PUBLIC_*` dashboard-link vars are
optional. The few with a non-obvious value or flag:

| Variable                   | Production value / handling                                               |
| -------------------------- | ------------------------------------------------------------------------- |
| `CONVEX_DEPLOY_KEY`        | the `prod:` deploy key from the [Convex](./convex.md) step; `--sensitive` |
| `CLERK_SECRET_KEY`         | Production Clerk secret key; `--sensitive`                                |
| `CLERK_AUTHORIZED_PARTIES` | `https://www.<website-domain>` (exact origins, comma separated)           |

Set each with `vercel env add <NAME> production`, adding `--sensitive` for the
two secrets above:

```bash
vercel env add CONVEX_DEPLOY_KEY production --sensitive
vercel env add CLERK_SECRET_KEY production --sensitive
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

**Cookies / privacy.** Vercel says Web Analytics stores anonymized data without
cookies and resets its request-derived visitor hash daily; Speed Insights is not
tied to a visitor or IP address. The only cookies are Clerk's necessary
authentication cookies, so there is no optional-storage consent banner. Adding
cross-site or cookie-based tracking changes that decision: update the legal
pages and add controls before enabling it. Clerk's Legal setting must point to
the Terms and Privacy pages and require express consent in both instances.

## References

- Vercel environment variables: https://vercel.com/docs/environment-variables
- Vercel env CLI: https://vercel.com/docs/cli/env
- Vercel custom domains: https://vercel.com/docs/domains/set-up-custom-domain
- Next.js environment variables: https://nextjs.org/docs/app/guides/environment-variables
- Vercel Web Analytics privacy: https://vercel.com/docs/analytics
- Vercel Speed Insights privacy: https://vercel.com/docs/speed-insights/privacy-policy
