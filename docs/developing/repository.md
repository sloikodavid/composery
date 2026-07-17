---
title: Repository
description: Fresh-clone setup, workspace map, verification gates, and the normal change workflow.
---

This is the zero-config entry point: assume only source access and no configured
local environment or external services. Product deployment continues under
[Web](./web/index.md), IDE-fork work under [IDE](./ide.md), and store releases
under [Mobile](./mobile.md).

## Fresh clone

The supported Node line is pinned in `.nvmrc`; pnpm is pinned by
`packageManager` in the root `package.json`. The IDE build also needs Git LFS,
Git submodules, and Quilt. CLI work needs the Rust toolchain pinned in CI.

```bash
git clone --recurse-submodules https://github.com/<github-user>/<repo>.git
cd <repo>
git lfs install
git lfs pull
corepack enable
pnpm install --frozen-lockfile
```

If the clone already exists, repair its submodules with:

```bash
git submodule update --init --recursive
git lfs pull
```

Do not hand-edit dependency versions into a package manifest. Install or update
them through pnpm so the manifest and lockfile move together.

## Workspace map

| Path                | Responsibility                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `packages/web`      | Public site, customer dashboard, staff console, Convex backend, cloud orchestration, and these docs |
| `packages/ide`      | Owned hard fork of code-server, assembled from the upstream submodule, Quilt patches, and overlay   |
| `packages/mobile`   | Expo mobile client and Maestro flows                                                                |
| `packages/cli`      | Rust CLI and persistence service                                                                    |
| `packages/brand`    | Generated brand assets shared by product surfaces                                                   |
| `rootfs`            | Files installed into the shipped runtime image                                                      |
| `templates`         | Self-hosting templates                                                                              |
| `tests`             | Cross-package integration and patch-stack tests                                                     |
| `.github/workflows` | CI, smoke, release, and maintenance automation                                                      |

Read the nearest `AGENTS.md` before editing a package. In particular, upstream
files under `packages/ide/upstream` are never edited in place: upstream changes
are Quilt patches and fork-only files are path-mirrored under `overlay`.

## Daily commands

```bash
pnpm dev
pnpm check
pnpm build
pnpm smoke
```

`pnpm dev` starts the tree watcher, development container, Convex, Next.js, and
mobile client. Run narrower scripts while iterating, such as
`pnpm --filter web check`, but run the root `pnpm check` before opening a pull request. The root
gate covers TypeScript, ESLint, Prettier, Vitest, the generated repository tree,
Renovate config, the IDE patch stack, Rust formatting/lints/tests, and brand
assets. CI then runs the complete build as a separate bundling gate.

`scripts/tree.mjs` owns the tree embedded in the root `AGENTS.md`. If a change
adds, moves, or removes tracked paths, run `pnpm fix:tree`; do not manually
rewrite the generated block. Generated Convex API files may change after
function/schema changes and should be reviewed like any other generated diff.

## Change workflow

1. Pull the target branch and inspect `git status`; never discard unrelated
   local work.
2. Read the nearest instructions and the relevant developing runbook.
3. Make the smallest coherent change. Keep environment examples and provider
   docs in the same change as configuration behavior.
4. Run focused tests while iterating, then the appropriate package check.
5. Run `pnpm check`; run the build or smoke path when the change can affect
   packaging, routing, runtime boot, or provider integration.
6. Review the final diff for secrets, generated noise, stale wording, and
   unintentional provider/account assumptions.
7. Use a pull request. CI checks the Quilt stack with fuzz zero before the full
   build, so upstream patch drift fails loudly.

## Releases

The web frontend deploys through Vercel as described in
[Web / Vercel](./web/services/vercel.md). Convex functions deploy separately with their
configured deployment. The shipped self-hosted product is a multi-architecture
GHCR image. `.github/RELEASE.md` is the source-of-truth procedure: preview refs
publish preview tags; a stable run from current `main` reads the root semver,
publishes immutable version/SHA tags plus moving convenience tags, scans the
image, attests it, and creates the GitHub release. Never create stable `v*` tags
manually. The GitHub-side repository configuration - settings, rulesets,
Actions, GHCR, community intake, CLA, and Renovate - is
[Services / GitHub](./services/github.md).

## Secrets and scratch work

Provider secrets belong in the provider's secret store or deployment
environment, never in Git, screenshots, issue text, shell history copied into a
PR, or documentation examples. Use the gitignored `tmp/` directory for local
artifacts. If a secret appears in a commit or shared log, rotate it at the
provider; deleting the visible text is not sufficient remediation.
