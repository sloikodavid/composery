---
title: IDE
description: Shared theme and upstream / VS Code bump runbook for the editor fork in packages/ide.
---

Runbook for values and generated artifacts in `packages/ide/` that drift: things
that are correct today only because something upstream has not moved yet. Keep
one source of truth and derive the rest where practical, so maintenance is
usually a generator or update PR, not hand-retyping values.

Browser-, operator-, and runtime-facing names are Composery. Repo package names
stay domain nouns (`ide`, `web`, `mobile`, `brand`, `cli`), while shipped binaries,
paths, product metadata, settings files, cookies, sockets, and product-specific
environment variables use Composery names. `code-server` stays only as upstream
provenance: the submodule source, patch coordinates, and source URL metadata.

## Shared theme

`packages/shared/theme.json` is the editable source for the website theme and
the IDE theme. The IDE has its own workbench, editor, syntax, and terminal roles;
only diagnostics, Git decorations, diff markers, and the matching ANSI status
colours deliberately share the website's semantic status roles. `theme.ts` is
the generated TypeScript form; `index.ts` re-exports both areas and derives the
logo and app colours from the website area.

Run `pnpm dev:theme` for the local editor, or edit `theme.json` directly, then
run `pnpm assets`. Its Website and IDE previews are representative component and
workbench states, not copied production screens. Every control paints a preview
state and feeds the corresponding generated artifact. The asset build regenerates
the TypeScript exports, editor themes, CSS, favicons, launcher icons, and splash
screens.

- **Editor themes**.
  `packages/ide/overlay/lib/vscode/extensions/composery-themes/themes/composery-{dark,light}.json`.
  Generated from the pinned VS Code Dark/Light Modern themes. Product chrome
  and syntax follow the IDE roles; diagnostics, Git decorations, diff markers,
  and ANSI red/green/yellow/blue share the website
  success/destructive/warning/info roles. Diff and invalid scopes are status
  colours by meaning. The true editor default is set via
  `packages/ide/patches/brand.diff`, which points
  `ThemeSettingDefaults.COLOR_THEME_DARK` and `COLOR_THEME_LIGHT` at them (no
  `configurationDefaults`, no `initialColorTheme` hack). Keep light and dark
  symmetric: every chrome key one theme retints, the other should too.
- **Auth pages**.
  `packages/ide/overlay/src/browser/pages/brand.css` feeds the variables used by
  `global.css` for login, register, reset, and error pages.
- **Startup page**.
  `packages/ide/overlay/src/node/persistence/readiness.ts` (`renderStartupPage`),
  the "Preparing workspace" page shown until the workspace is ready, wired in by
  our owned `packages/ide/overlay/src/node/routes/index.ts` (the `persistenceGate`).
- **Logo**.
  `packages/ide/patches/brand.diff` and
  `packages/ide/overlay/src/browser/media/composery-logo.svg` (same icon paths
  and styled text fill).
- **Auth backend (register / change-password / cloud flow)**.
  New modules and routes live in
  `packages/ide/overlay/src/node/{session.ts,routes/...}`. Changes to upstream
  authentication and login files live in the concern-specific
  `packages/ide/patches/{auth,sessions}.diff` patches. `sessions.diff` is the
  boundary that validates the signed, expiring Composery session format every
  sign-in path issues.
- **Product rebrand**.
  `packages/ide/scripts/rebrand.mjs` runs after quilt and overlay, before the upstream
  build. It rewrites the assembled tree from upstream product names to Composery
  names and fails if live product code still contains old `code-server`, `Coder`,
  `CODE_SERVER_*`, or `CS_*` surfaces. This keeps broad rename rules generated
  and bump-friendly instead of spreading fragile hunks across every upstream file.
- **Welcome tiles**.
  `packages/shared/scripts/icons.mjs`, fed by `packages/shared/index.ts`.

The `COLOR_THEME_*_INITIAL_COLORS` first-paint snapshot also lives in
`brand.diff`. Themes load
asynchronously and frame one needs colors before the JSON parses, so VS Code
keeps a synchronous snapshot; this is upstream's mechanism, not ours. The patch
must match the generated theme JSONs for every overlapping key; the "default
color theme" tests apply the patch and compare the built result, so a stale
first frame fails rather than silently flashing another palette.

## Upstream / VS Code Bumps

The editor is built from pristine upstream (the `packages/ide/upstream/`
submodule, pinned in `.gitmodules`) plus our overlay and patch stack. It is not a
hard fork: `src/` is never checked in. `packages/ide/scripts/build.sh` copies the
submodule into a scratch `build/` tree, appends our `patches/series` to
upstream's, `quilt push -a` (fuzz=0), path-mirrors `overlay/` onto the tree,
runs `packages/ide/scripts/rebrand.mjs`, then runs the upstream `npm ci` / build /
release.

There are two kinds of customization, kept deliberately separate:

- **Patches** (`packages/ide/patches/`) modify files that exist upstream, in
  either code-server's `src/` or VS Code's `lib/vscode/*`. Each patch owns one
  concern and applies at fuzz 0, so an upstream move fails loudly instead of
  leaving a customization inert.
- **Overlay** (`packages/ide/overlay/`) contains only files that do not exist
  upstream, path-mirrored onto the tree after quilt push. It carries new
  server modules and routes, browser assets/pages, and extensions. Never place
  a modified copy of an upstream file here.
- **Rebrand** (`packages/ide/scripts/rebrand.mjs`) is a generated transformation over the
  assembled tree. It owns every product name and product-specific env var:
  `COMPOSERY_PASSWORD`, `COMPOSERY_HASHED_PASSWORD`, `COMPOSERY_PROXY_URI`,
  `COMPOSERY_EXTENSIONS_GALLERY`, `COMPOSERY_LOG_LEVEL`,
  `COMPOSERY_GITHUB_TOKEN`, `COMPOSERY_SESSION_LIFETIME`, and the narrower
  `COMPOSERY_*` toggles. No patch renames anything - a hunk anchors on
  upstream's spelling (`CS_DISABLE_FILE_UPLOADS`) and the rule rewrites it
  afterwards, so there is exactly one place to look for where a name comes from.

This is intentionally source-build territory. An upstream bump is never just
the submodule pointer: the patch stack is applied against that source at build
time, and the overlay files must be re-merged against the new upstream `src/node`
versions. On each bump:

- Sync the patch base.
  Check out the new upstream commit in `packages/ide/upstream` (and its
  nested `lib/vscode` submodule). That tree is the authoring/check base, not a
  guess from memory.
- Re-check every patch.
  Patches can fail loudly or silently no-op if upstream moved the code they
  target. The authoring recipe is in `packages/ide/scripts/build.sh`; do not duplicate
  it here.
- Re-check overlay collisions.
  Every overlay path must remain absent upstream. If upstream adds a file at one
  of those paths, move our concern into a patch or choose a genuinely owned new
  module rather than masking the upstream file.
- Re-run the rebrand check.
  `pnpm check:ide` assembles the server tree, runs `rebrand.mjs`, and typechecks
  it. If upstream introduces new live product names, add an explicit replacement
  or a narrow allowlist only for real VS Code internals.
- Re-flatten the themes.
  Use the new Dark/Light Modern base, then regenerate the first-paint maps.

The image build is the only real check of the full stack. Budget for it.
CI also runs an early gate that lays our patch stack over the submodule and runs
`quilt push -a` with `--fuzz=0` (see `.github/workflows/ci.yml`). That catches
broken patch application before the full image build, but it does not prove the
patched app builds or behaves correctly.

Releases and dependency upgrades: see `.github/workflows/release.yml` and `renovate.json`.
