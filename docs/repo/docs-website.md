---
title: Docs website
description: Deploy packages/docs-website to Vercel.
---

`packages/docs-website` is the Next.js + Fumadocs site that serves this repo's
`docs/` directory at `https://docs.composery.io`. It is a separate Vercel
project from `https://www.composery.io`: no shared backend, no environment variables, no secrets.

`packages/docs-website/vercel.json` pins the framework preset and install
command. Link the project from the package directory:

```bash
cd packages/docs-website
vercel link
```

Then set the two project-level settings `vercel.json` cannot encode (Vercel dashboard -> Project -> Settings):

- **Root Directory** = `packages/docs-website`.
- **Include source files outside of the Root Directory in the Build Step** =
  Enabled. The build reads `docs/` and the root `pnpm-lock.yaml` /
  `pnpm-workspace.yaml`, all outside the package.

Add `docs.composery.io` under Settings -> Domains. `src/app/layout.tsx` already
sets `metadataBase` to that origin.
