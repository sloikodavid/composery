---
title: IDE
description: Brand palette and upstream / VS Code bump runbook for the editor fork in packages/ide.
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

## Brand palette

The Composery palette is shared from `packages/shared/index.ts` - `theme` for the
roles every surface shares, `ideTheme` for what only the editor has (chrome that
sits flush with the canvas, syntax, ANSI) - along with the same icon geometry
across web, mobile, and the editor.

Edit colours through `pnpm theme`, the colour console in `scripts/color-console/`.
It shows every role with live website, mobile and editor previews plus a contrast
table, and applying an edit fans it out in one pass: both palettes in
`index.ts`, the two theme JSONs role by role, the first-paint pins in the patch
stack, the hand-synced copies below, and the generators. Editing a colour by hand
means doing that fan-out yourself. Regenerate derived files instead of
hand-copying brand values:

- **Editor themes**.
  `packages/ide/overlay/lib/vscode/extensions/composery-themes/themes/composery-{dark,light}.json`.
  Hand-authored builtin themes, VS Code Dark/Light Modern retinted to the
  Composery brand while syntax `tokenColors` stay Modern. Not generated: the
  brand palette is a reference, and the "default color theme" tests in
  `tests/code-server-patches.test.ts` assert the handful of genuinely shared
  keys (backgrounds, foregrounds, buttons, borders) still match
  `packages/shared/index.ts`. The true editor default via
  `packages/ide/patches/product.diff`, which points
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
  `packages/ide/patches/product.diff` and
  `packages/ide/overlay/src/browser/media/composery-logo.svg` (same icon paths
  and styled text fill).
- **Auth backend (register / change-password / login flow)**.
  `packages/ide/overlay/src/node/routes/{register,changePassword,passwordConfig,login}.ts`
  and `packages/ide/overlay/src/node/{cli,http,main}.ts` - whole owned files, not
  patches. Readable and editable directly.
- **Upstream server customizations** (`toLocalBrowserAddress`,
  no-generated-password, `change-password` CLI flag, auth routes).
  `packages/ide/overlay/src/node/{cli,http,main,util,wrapper,routes/...}.ts` -
  whole owned files.
- **Product rebrand**.
  `packages/ide/scripts/rebrand.mjs` runs after quilt and overlay, before the upstream
  build. It rewrites the assembled tree from upstream product names to Composery
  names and fails if live product code still contains old `code-server`, `Coder`,
  `CODE_SERVER_*`, or `CS_*` surfaces. This keeps broad rename rules generated
  and bump-friendly instead of spreading fragile hunks across every upstream file.
- **Welcome tiles**.
  `packages/shared/scripts/icons.mjs`, fed by `packages/shared/index.ts`.

The `COLOR_THEME_*_INITIAL_COLORS` first-paint snapshot also lives in
`product.diff`, hand-maintained like every other patch. Themes load
asynchronously and frame one needs colors before the JSON parses, so VS Code
keeps a synchronous snapshot; this is upstream's mechanism, not ours. The patch
retints upstream's snapshot values with the theme JSONs' values (keys the
themes do not define keep upstream's line), and the "default color theme" tests
in `tests/code-server-patches.test.ts` apply the patch and fail on any key that
drifts from the theme JSONs - so it cannot silently fall behind. When the
themes change, update the patch's color lines too, and confirm no `#0078D4`
dark or `#005FB8` light survives.

## Upstream / VS Code Bumps

The editor is built from pristine upstream (the `packages/ide/upstream/`
submodule, pinned in `.gitmodules`) plus our overlay and patch stack. It is not a
hard fork: `src/` is never checked in. `packages/ide/scripts/build.sh` copies the
submodule into a scratch `build/` tree, appends our `patches/series` to
upstream's, `quilt push -a` (fuzz=0), path-mirrors `overlay/` onto the tree,
runs `packages/ide/scripts/rebrand.mjs`, then runs the upstream `npm ci` / build /
release.

There are two kinds of customization, kept deliberately separate:

- **Patches** (`packages/ide/patches/`) are VS Code-side only (`lib/vscode/*`):
  brand svgs, welcome, touch/narrow, theme cache, clipboard, etc. These must be
  patches because the VS Code build minifies/relocates the source, so a whole
  owned file would not survive the build. Upstream's own patches apply
  **unmodified** - we do not
  fork them.
- **Overlay** (`packages/ide/overlay/`) is whole owned files, path-mirrored onto
  the tree after quilt push. This carries our owned upstream-server `src/node/*`
  customizations (cli, http, main, util, wrapper, routes, persistence, the auth
  backend) and all browser assets/pages/extensions. Whole files, not diffs -
  readable and diffable directly.
- **Rebrand** (`packages/ide/scripts/rebrand.mjs`) is a generated transformation over the
  assembled tree. It owns systematic product names and product-specific env vars:
  `COMPOSERY_PASSWORD`, `COMPOSERY_HASHED_PASSWORD`, `COMPOSERY_PROXY_URI`,
  `COMPOSERY_EXTENSIONS_GALLERY`, `COMPOSERY_LOG_LEVEL`,
  `COMPOSERY_GITHUB_TOKEN`, and the narrower `COMPOSERY_*` toggles.

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
- Re-merge the overlay `src/node` files.
  Diff each owned file against the new upstream version and re-apply our changes.
  Easier than patches: you see the whole file, and `git diff` against the new
  upstream shows exactly what moved.
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
