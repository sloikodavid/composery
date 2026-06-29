---
title: Maintenance
description: Keep repo values, generated artifacts, and upstream patch machinery from drifting.
---

Runbook for values and generated artifacts in this repo that drift: things that
are correct today only because something upstream has not moved yet. Keep one
source of truth and derive the rest where practical, so maintenance is usually a
generator or update PR, not hand-retyping values.

Browser- and operator-facing names are Composery. Keep `code-server` only for
upstream machinery: cloned source, patch coordinates, the CLI binary, direct
exec paths, artifact paths, and env contracts.

## Brand palette

The Composery palette (warm amber accent, warm surfaces and foregrounds) is the
editor counterpart of the website brand. It is hardcoded as hex in several
committed places, each hand-maintained. There is no shared token source, so a
brand change means editing all of them together:

- **Editor themes**.
  `packages/ide/overlay/lib/vscode/extensions/composery-themes/themes/composery-{dark,light}.json`.
  Self-contained builtin themes, VS Code Dark/Light Modern retinted to the amber
  brand while syntax `tokenColors` stay Modern. The true editor default via
  `packages/ide/patches/default-color-theme.diff`, which points
  `ThemeSettingDefaults.COLOR_THEME_DARK` and `COLOR_THEME_LIGHT` at them (no
  `configurationDefaults`, no `initialColorTheme` hack). Keep light and dark
  symmetric: every chrome key one theme retints, the other should too, or one
  theme leaks upstream's Modern blue.
- **Auth pages**.
  `packages/ide/overlay/src/browser/pages/global.css` (login, register,
  reset, error).
- **Startup page**.
  `packages/ide/overlay/src/node/persistence/readiness.ts` (`renderStartupPage`),
  the "Preparing workspace" page shown until the workspace is ready, wired in by
  our owned `packages/ide/overlay/src/node/routes/index.ts` (the `persistenceGate`).
- **Logo and wordmark**.
  `packages/ide/patches/branding.diff` and
  `packages/ide/overlay/src/browser/media/composery-logo.svg` (amber
  gradient and fill).
- **Auth backend (register / reset-password / login flow)**.
  `packages/ide/overlay/src/node/routes/{register,resetPassword,passwordConfig,login}.ts`
  and `packages/ide/overlay/src/node/{cli,http,main}.ts` - whole owned files, not
  patches. Readable and editable directly.
- **code-server src/node customizations** (env-var rename to `COMPOSERY_*`, paths,
  `toLocalBrowserAddress`, no-generated-password, `reset-password` CLI flag).
  `packages/ide/overlay/src/node/{cli,http,main,util,wrapper,routes/...}.ts` -
  whole owned files. The two env vars that cross into VS Code
  (`CODE_SERVER_SESSION_SOCKET`, `CODE_SERVER_PARENT_PID`) keep upstream's names
  so code-server's own `integration.diff` and `store-socket.diff` apply unmodified.
- **Welcome tiles**.
  `scripts/generate-icons.mjs`, the `TILE_BG` constant.

One place is generated, not hand-maintained: the `COLOR_THEME_*_INITIAL_COLORS`
first-paint snapshot in `default-color-theme.diff`. Themes load asynchronously and
frame 1 needs colors before the JSON parses, so VS Code keeps a synchronous
snapshot; this is upstream's mechanism, not ours. It is generated from the theme
JSON files and covers every key, so it cannot silently fall behind. Regenerate it
when the themes change, never hand-edit the patch's color lines, and confirm no
`#0078D4` dark or `#005FB8` light survives.

## code-server / VS Code Bumps

The editor is built from pristine code-server (the `packages/ide/upstream/`
submodule, pinned in `.gitmodules`) plus our overlay and patch stack. It is not a
hard fork: `src/` is never checked in. `packages/ide/build.sh` copies the
submodule into a scratch `build/` tree, appends our `patches/series` to
code-server's, `quilt push -a` (fuzz=0), path-mirrors `overlay/` onto the tree,
then runs code-server's `npm ci` / build / release.

There are two kinds of customization, kept deliberately separate:

- **Patches** (`packages/ide/patches/`) are VS Code-side only (`lib/vscode/*`):
  brand svgs, welcome, touch/narrow, theme cache, clipboard, etc. These must be
  patches because the VS Code build minifies/relocates the source, so a whole
  owned file would not survive the build. code-server's own 25 patches (including
  `integration.diff` and `store-socket.diff`) apply **unmodified** - we do not
  fork them.
- **Overlay** (`packages/ide/overlay/`) is whole owned files, path-mirrored onto.
  the tree after quilt push. This carries all our code-server `src/node/*`
  customizations (cli, http, main, util, wrapper, routes, persistence, the auth
  backend) and all browser assets/pages/extensions. Whole files, not diffs -
  readable and diffable directly.

This is intentionally source-build territory. A code-server bump is never just
the submodule pointer: the patch stack is applied against that source at build
time, and the overlay files must be re-merged against the new upstream `src/node`
versions. On each bump:

- Sync the patch base.
  Check out the new code-server commit in `packages/ide/upstream` (and its
  nested `lib/vscode` submodule). That tree is the authoring/check base, not a
  guess from memory.
- Re-check every patch.
  Patches can fail loudly or silently no-op if upstream moved the code they
  target. The authoring recipe is in `packages/ide/build.sh`; do not duplicate
  it here.
- Re-merge the overlay `src/node` files.
  Diff each owned file against the new upstream version and re-apply our changes.
  Easier than patches: you see the whole file, and `git diff` against the new
  upstream shows exactly what moved.
- Re-flatten the themes.
  Use the new Dark/Light Modern base, then regenerate the first-paint maps.

The image build is the only real check of the full stack. Budget for it.
CI also runs an early gate that lays our patch stack over the submodule and runs
`quilt push -a` with `--fuzz=0` (see `.github/workflows/ci.yml`). That catches
broken patch application before the full image build, but it does not prove the
patched app builds or behaves correctly.

## Versioning and releases

Three independent version surfaces. They do not share a number and nothing
auto-syncs them - each is the source of truth for its own product.

- **Appliance image** - root `/package.json` `version` (plain semver `X.Y.Z`).
  `.github/workflows/release.yml` reads it (`node -p "require('./package.json').version"`)
  and, on a stable run (workflow dispatched with `ref: main`, HEAD = origin/main),
  turns that one number into the GHCR tags `:X.Y.Z` / `:X.Y` / `:latest` /
  `:sha-<12>`, a git tag `vX.Y.Z` (the run fails if it already exists, forcing a
  bump), a GitHub Release, and the image's `COMPOSERY_BUILD_VERSION`. To cut a
  stable release: bump this number, merge to main, run the workflow. Any other
  ref is a *preview* release - tagged `preview-<sha>`, version number ignored.
- **Mobile app** - `packages/mobile-app/app.json` `version` (marketing version
  the stores key on). Separate lifecycle, separate gate (store review). EAS
  manages the build/version codes server-side (`appVersionSource: remote`), so
  this is the only number you hand-edit. See [mobile-app](./mobile-app.md).
- **docs-website** - unversioned. Auto-deploys to Vercel on push.

The `version` fields in `packages/mobile-app/package.json` and
`packages/docs-website/package.json` are npm metadata and are ignored by every
release path. Dockerfile pins (`CODE_SERVER_COMMIT`, `NODE_IMAGE`, `BUN_VERSION`,
etc.) are dependency inputs, not the product version - see Renovate below.

## Renovate

Version updates are automated by `renovate.json`. It tracks:

- Docker base images in `Dockerfile`, with digests pinned.
- The `# renovate:` Dockerfile ARGs.
  Renovate tracks `bun`, `npm`, `pnpm`, and `cargo-chef`.
- `coder/code-server`.
  A custom GitHub-tags datasource keeps version and commit moving together.
- npm, Cargo, and GitHub Actions dependencies from their normal manifests.

Renovate intentionally does not track Debian apt package versions. Runtime apt
packages stay unpinned and come from the Debian suite in the base image. That is
the policy: Debian owns system-tooling freshness; this repo pins the image, not
every package inside the suite.

The config is conservative: no automerge, a 3-day minimum release age, majors
gated behind the dependency dashboard, and Docker digests pinned. Review PRs
normally. For a code-server PR, run the bump steps above before merging.
