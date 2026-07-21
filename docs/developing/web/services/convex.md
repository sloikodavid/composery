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

- `CONVEX_CLOUD_URL` - client URL, same as `NEXT_PUBLIC_CONVEX_URL`.
- `CONVEX_SITE_URL` - HTTP Actions URL, e.g. `https://<name>.convex.site`. You
  need it for the [Polar](./polar.md) webhook (`<CONVEX_SITE_URL>/polar/events`).

## Production deploy key

In the Convex dashboard, generate a production deploy key for the production
deployment (Deployment Settings -> production deployment -> Generate Production
Deploy Key). Grant only `deployment:deploy`. It starts with `prod:`; you paste
it into Vercel later. You do not need a deploy key locally (`convex dev` uses
your CLI login), and you do not need a preview deploy key.

## Set Convex environment variables

After walking the provider pages, enter the values you collected into the Convex
dashboard, separately for the dev and production deployments (Deployment Settings
-> Environment Variables). The deployment is the live store; these values are
sensitive and account-specific, so a human enters them there. They are not
committed and not read from `.env.local`.

`packages/web/.env.example.convex.dev` and `packages/web/.env.example.convex.prod`
are the authoritative list of which keys each deployment needs, with their
non-secret defaults and a comment on each saying where to obtain the value. Copy
from them; this page does not restate the names, and a variable absent from those
files does not belong on the deployment. `CLERK_SECRET_KEY` also lives in the
Next env - it is the one variable set on both planes, the same Clerk secret the
deployment uses for staff-triggered account deletion (`convex/accountDeletion.ts`).

Only `CLERK_FRONTEND_API_URL` is required at deploy time. Convex evaluates
`convex/auth.config.ts` during every push, and it calls
`requiredEnv("CLERK_FRONTEND_API_URL")`, so a deployment with that var unset fails
the deploy with `Missing Convex environment variable: CLERK_FRONTEND_API_URL`.
Every other backend var is read inside functions at runtime, so a missing one
breaks only the feature that first reads it. The environment examples are the
source-of-truth checklist; keep optional keys present with an empty value.

For a one-off from the CLI, `convex env set NAME value` (dev) or
`convex env set --prod NAME value` works too. Check what is set with
`convex env list` (dev) or `convex env list --prod`. After setting them, push and
codegen again:

```bash
pnpm exec convex dev --once
```

## References

- Convex Vercel hosting: https://docs.convex.dev/production/hosting/vercel
- Convex deploy CLI: https://docs.convex.dev/cli/reference/deploy
- Convex deploy keys: https://docs.convex.dev/cli/deploy-key-types
- Convex environment variables: https://docs.convex.dev/production/environment-variables
