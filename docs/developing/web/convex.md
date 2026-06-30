---
title: Convex
description: Create the dev and production Convex deployments, then set backend env vars per deployment.
---

One Convex project holds two deployments: a dev deployment you push to from your
logged-in CLI, and a production deployment Vercel pushes to with a `prod:` key.
Create them now; you set their env vars later, after the provider steps.

## Create the project and dev deployment

```bash
pnpm exec convex dev --once
```

The first run creates or links the project and writes `CONVEX_DEPLOYMENT` and
`NEXT_PUBLIC_CONVEX_URL` for the dev deployment into `packages/web/.env.local`. It
may warn that env vars are unset - expected; you set them in
[Set Convex environment variables](#set-convex-environment-variables) below.

Note each deployment's two URLs (Convex dashboard -> the deployment -> Settings):

- `CONVEX_CLOUD_URL` - client URL, same as `NEXT_PUBLIC_CONVEX_URL`. Also goes in
  `.env.local` as `NEXT_PUBLIC_CONVEX_SITE_URL`'s sibling for reference.
- `CONVEX_SITE_URL` - HTTP Actions URL, e.g. `https://<name>.convex.site`. You
  need it for the [Polar](./polar.md) webhook (`<CONVEX_SITE_URL>/polar/events`).

## Production deploy key

In the Convex dashboard, generate a production deploy key for the production
deployment (Deployment Settings -> production deployment -> Generate Production
Deploy Key). It starts with `prod:`; you paste it into Vercel later. You do not
need a deploy key locally (`convex dev` uses your CLI login), and you do not need
a preview deploy key.

## Set Convex environment variables

After walking the provider pages, enter the values you collected into the Convex
dashboard, separately for the dev and production deployments (Deployment Settings
-> Environment Variables). The deployment is the live store; these values are
sensitive and account-specific, so a human enters them there. They are not
committed and not read from `.env.local`.

Use `packages/web/.env.example.convex.dev` and `packages/web/.env.example.convex.prod`
as the checklist of which keys each deployment needs and their non-secret
defaults. The keys are `CLERK_FRONTEND_API_URL`, `WEBSITE_ORIGIN`, `CLOUD_DOMAIN`,
the `POLAR_*`, `HETZNER_*`, `CLOUDFLARE_*` groups, plus `RUNTIME_IMAGE`,
`RUNTIME_PORT`, `SSH_USER`, `SSH_PRIVATE_KEY`, `RESEND_API_KEY`, `ALERT_EMAIL_FROM`.
Do not put frontend-plane vars (`CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_*`,
`CLERK_SECRET_KEY`, `CLERK_AUTHORIZED_PARTIES`) on the deployment.

Only `CLERK_FRONTEND_API_URL` is required at deploy time. Convex evaluates
`convex/auth.config.ts` during every push, and it calls
`requiredEnv("CLERK_FRONTEND_API_URL")`, so a deployment with that var unset fails
the deploy with `Missing Convex environment variable: CLERK_FRONTEND_API_URL`.
Every other backend var is read inside functions at runtime, so a missing one
only breaks the feature that needs it, not the deploy (see `convex/billing/polar.ts`,
which reads its env tolerantly for exactly this reason).

For a one-off from the CLI, `convex env set NAME value` (dev) or
`convex env set --prod NAME value` works too. Check what is set with
`convex env list` (dev) or `convex env list --prod`. After setting them, push and
codegen again:

```bash
pnpm exec convex dev --once
```

## References

- Convex Vercel hosting: https://docs.convex.dev/production/hosting/vercel.
- Convex deploy CLI: https://docs.convex.dev/cli/reference/deploy.
- Convex deploy keys: https://docs.convex.dev/cli/deploy-key-types.
- Convex environment variables: https://docs.convex.dev/production/environment-variables.