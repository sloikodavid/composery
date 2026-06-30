---
title: Web
description: Deploy packages/web to Vercel.
---

`packages/web` is the Next.js app behind `https://www.composery.io`: the
marketing pages, the boxes dashboard, the staff console, and the Fumadocs-rendered
documentation at `/docs` (this repo's `docs/` directory). Unlike the old
standalone docs site, it has a backend - Convex, Clerk auth, and Polar billing -
all configured through environment variables. See `packages/web/.env.example.*`
and `packages/web/docs/setup.md` for the full list.

`packages/web/vercel.json` pins the framework preset and the install command
(`pnpm install` from the repo root, so the workspace resolves). Link the project
from the package directory:

```bash
cd packages/web
vercel link
```

Then set the two project-level settings `vercel.json` cannot encode (Vercel
dashboard -> Project -> Settings):

- **Root Directory** = `packages/web`.
- **Include source files outside of the Root Directory in the Build Step** =
  Enabled. The build reads `docs/` and the root `pnpm-lock.yaml` /
  `pnpm-workspace.yaml`, all outside the package.

Add `www.composery.io` under Settings -> Domains. The documentation is served at
`/docs` on that same origin - there is no longer a separate docs subdomain.
