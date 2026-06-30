---
title: Web
description: Next.js app, providers, and the per-step setup runbook for a fresh clone.
---

`packages/web` is the Next.js app behind `https://www.<website-domain>`: the
marketing pages, the boxes dashboard, the staff console, and the Fumadocs-rendered
documentation at `/docs` (this repo's `docs/` directory). It has a backend -
Convex, Clerk auth, and Polar billing - all configured through environment
variables in `packages/web/.env.example.*` and the per-provider pages here.

Stack: Next.js on Vercel, Convex (functions, database, HTTP actions, crons, auth
config, `@convex-dev/polar`, `@convex-dev/workflow`), Clerk, Polar, Hetzner Cloud
(per-box VPS), Cloudflare DNS (per-box `A`/`AAAA`), a public runtime container
image, Caddy in each box for HTTPS, and Hetzner snapshots for restore points.
Periodic work is handled by Convex crons - no separate Layer, Headless, or Poller
service.

## Environment model

This is a solo project with two long-lived backends and no preview/staging tier:

| Purpose     | Git branch | Vercel                | Convex                | Clerk                      | Polar            | Infra                                          |
| ----------- | ---------- | --------------------- | --------------------- | -------------------------- | ---------------- | ---------------------------------------------- |
| Development | local only | `pnpm run dev`        | dev deployment        | development Clerk instance | Polar sandbox    | dev Hetzner project and Cloudflare namespace   |
| Production  | `main`     | Production deployment | production deployment | production Clerk instance  | Polar production | production Hetzner project and Cloudflare zone |

**Two config planes**, set in different places:

- _Frontend env_ is read by Next.js. It lives in `.env.local` (local) and Vercel
  Production:
  - `CONVEX_DEPLOYMENT` (Convex CLI only), `NEXT_PUBLIC_CONVEX_URL`,
    `NEXT_PUBLIC_CONVEX_SITE_URL`.
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`,
    `CLERK_SECRET_KEY`, `CLERK_AUTHORIZED_PARTIES` (`proxy.ts`).
  - `NEXT_PUBLIC_POLAR_ENVIRONMENT`, `NEXT_PUBLIC_POLAR_ORGANIZATION_SLUG`
    (`lib/polar-dashboard.ts`), `NEXT_PUBLIC_HETZNER_PROJECT_ID`
    (`lib/hetzner-dashboard.ts`).
- _Convex deployment env_ is read by Convex functions/actions/auth/crons. A
  human sets it per deployment in the Convex dashboard (Deployment Settings ->
  Environment Variables); it lives on the deployment, not on your machine:
  - `CLERK_FRONTEND_API_URL` (`convex/auth.config.ts`).
  - `WEBSITE_ORIGIN`, `CLOUD_DOMAIN` (`convex/env.ts`).
  - `POLAR_*` (`convex/billing/polar.ts`), `HETZNER_*` and `SSH_*`
    (`convex/boxes/infra/`), `CLOUDFLARE_*`, `RUNTIME_IMAGE`, `RUNTIME_PORT`.

Putting a Convex deployment var in `.env.local` does nothing at runtime - it
takes effect only on the deployment.

Domain split:

- Production website: `https://www.<website-domain>` (checkout success URLs).
  Production canonicalizes on `www`: the apex `<website-domain>` redirects to
  `https://www.<website-domain>`, so only the `www` origin serves the app and
  only it is listed in `CLERK_AUTHORIZED_PARTIES`.
- Production runtime boxes: `https://<slug>.<cloud-domain>`.
- Development website: `http://localhost:3000`.
- Development runtime boxes: `https://<slug>.dev.<cloud-domain>` (only if you
  provision in dev; see [Cloudflare](./cloudflare.md)).

`WEBSITE_ORIGIN` is a full origin (scheme + host, plus a port in dev) because it
builds website URLs and dev runs on `http://localhost:3000`. `CLOUD_DOMAIN` is a
bare host because it is only ever a DNS suffix in `<slug>.<CLOUD_DOMAIN>`. Two
different things, not two spellings of one domain.

## Order of operations

1. Create the [Convex](./convex.md) deployments - their URLs must exist first
   (Polar webhook target `CONVEX_SITE_URL`, Clerk JWT issuer).
2. Set up each provider ([Clerk](./clerk.md), [Polar](./polar.md),
   [Hetzner](./hetzner.md), [Cloudflare](./cloudflare.md)). Each page names the
   value/variable it produces; some need the Convex URLs from step 1.
3. Enter the collected values into the Convex deployment env per deployment
   ([Convex](./convex.md) - "Set Convex environment variables").
4. Configure [Vercel](./vercel.md) (frontend env, prod deploy key, build
   settings) and deploy.

## Prerequisites

- Node.js `>=20.9.0` (Node 22 LTS is fine), pnpm, Vercel CLI.
- Access to the Vercel team/project, Convex team/project, Clerk apps, Polar
  organization, Hetzner Cloud project, Cloudflare zone, and container registry.

From a fresh clone:

```bash
git clone https://github.com/<github-user>/<repo>.git
cd <repo>
corepack enable
pnpm install
cp packages/web/.env.example.next.dev packages/web/.env.local
```

## Local development

`.env.local` holds frontend-plane values only; it is your copy of
`packages/web/.env.example.next.dev`. `convex dev` writes the [Convex](./convex.md)
identifiers; you fill the dev [Clerk](./clerk.md) keys. The Convex-plane values
live on the dev deployment (set them in [Convex](./convex.md) - "Set Convex
environment variables"), not in `.env.local`.

```bash
pnpm run dev
```

This runs `convex dev` (pushing functions and schema to the dev deployment) and
`next dev` together. Open `http://localhost:3000`. Local UI work runs without
real [Polar](./polar.md)/[Hetzner](./hetzner.md)/[Cloudflare](./cloudflare.md)
credentials until you test checkout or provisioning.

## Production deploy

`packages/web/vercel.json` pins the framework preset and the install command
(`pnpm install` from the repo root, so the workspace resolves). The full Vercel
project, env-var, and build-command setup is in [Vercel](./vercel.md); the short
version:

1. From `packages/web` run `vercel link`. Set the two project-level settings
   `vercel.json` cannot encode (Vercel dashboard -> Project -> Settings):
   - **Root Directory** = `packages/web`.
   - **Include source files outside of the Root Directory in the Build Step** =
     Enabled. The build reads `docs/` and the root `pnpm-lock.yaml` /
     `pnpm-workspace.yaml`, all outside the package.
2. Add `www.<website-domain>` under Settings -> Domains. The documentation is
   served at `/docs` on that same origin - there is no separate docs subdomain.
3. Push to `main`. Confirmed production [Convex](./convex.md) env (at least
   `CLERK_FRONTEND_API_URL`) and Vercel Production env vars must be in place
   first; see [Vercel](./vercel.md) for the checklist.
