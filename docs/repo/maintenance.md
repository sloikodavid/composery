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
  `vendor/code-server/overlay/lib/vscode/extensions/composery-themes/themes/composery-{dark,light}.json`.
  Self-contained builtin themes, VS Code Dark/Light Modern retinted to the amber
  brand while syntax `tokenColors` stay Modern. The true editor default via
  `vendor/code-server/patches/default-color-theme.diff`, which points
  `ThemeSettingDefaults.COLOR_THEME_DARK` and `COLOR_THEME_LIGHT` at them (no
  `configurationDefaults`, no `initialColorTheme` hack). Keep light and dark
  symmetric: every chrome key one theme retints, the other should too, or one
  theme leaks upstream's Modern blue.
- **Auth pages**.
  `vendor/code-server/overlay/src/browser/pages/global.css` (login, register,
  reset, error).
- **Startup page**.
  `vendor/code-server/patches/persistence-readiness.diff`, the "Preparing workspace"
  page shown until the workspace is ready.
- **Logo and wordmark**.
  `vendor/code-server/patches/branding.diff` and
  `vendor/code-server/overlay/src/browser/media/composery-logo.svg` (amber
  gradient and fill).
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

The editor is built from source in `Dockerfile`, pinned by
`CODE_SERVER_VERSION` and `CODE_SERVER_COMMIT`. Bump both together; Renovate does
this atomically through the custom `code-server-tags` datasource.

This is intentionally source-build territory. Downloading upstream release
tarballs would be simpler and better by default, but this repo applies
Composery's patch stack before `npm run build`, `npm run build:vscode`, and
`npm run release`. A code-server bump is never just those two ARG lines: the
whole `vendor/code-server/patches/series` stack is applied against that source at
build time. On each bump:

- Sync the patch base.
  Use the `../sources/code-server-<version>` clone. That clone is the
  authoring/check base, not a guess from memory.
- Re-check every patch.
  Patches can fail loudly or silently no-op if upstream moved the code they
  target. The authoring recipe is in `vendor/code-server/README.md`; do not
  duplicate it here.
- Re-flatten the themes.
  Use the new Dark/Light Modern base, then regenerate the first-paint maps.

The image build is the only real check of the full patch stack. Budget for it.
CI also runs `scripts/check-code-server-patches.mjs`, which is a cheaper early
gate: it clones the pinned source, checks the pinned commit, appends our patches,
and runs `quilt push -a`. That catches broken patch application before the full
image build, but it does not prove the patched app builds or behaves correctly.

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
