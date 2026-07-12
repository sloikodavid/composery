---
title: Developing
description: Runbooks for working on the Composery repository itself.
---

Everything under this section is for people working on the Composery repository,
not for running an instance. If you want to deploy Composery, start at
[Self-Hosting](../self-hosting/index.md).

- **[IDE](ide.md)** - the editor fork in `packages/ide`: brand palette sources and
  the upstream / VS Code bump runbook.
- **[Web](web/index.md)** - the Next.js website and cloud backend in `packages/web`,
  with per-provider setup pages (Convex, Clerk, Polar, Hetzner, Cloudflare, Resend,
  Vercel).
- **[Mobile](mobile.md)** - building and shipping `packages/mobile` to the App Store
  and Play Store.

Repository-wide commands live in the root `package.json`: `pnpm dev` runs the web,
Convex, Docker, and mobile dev processes together, and `pnpm check` runs every
typecheck, lint, format, and test gate CI runs.
