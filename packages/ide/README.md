# IDE

Hard fork of code-server 4.118.0 (commit 871f1d904834ee78db1c4585e2f14f65c119374a),
plucked to remove bloat we don't use (docs, helm chart, release images, npm packaging,
systemd units) and merged with Composery's patches and overlay assets.

## Layout

- `src/` — code-server source (Node server, browser pages, media). Our auth pages,
  media, and logos are dissolved directly into source (were overlay files).
- `ci/` — build scripts (build-code-server.sh, build-vscode.sh, build-release.sh,
  clean.sh, code-server.sh, lib.sh) and dev scripts (test runners, watch.ts).
- `tests/` — code-server's unit, e2e, and integration tests (jest + playwright).
- `patches/` — one merged quilt stack of our remaining VS Code-only patches.
  Ordered by `patches/series`; source patches have been converted to direct edits.
- `overlay/lib/vscode/extensions/` — our builtin VS Code extensions (composery-agents,
  composery-shortcuts, composery-themes). Copied onto the release after build.
- `overlay/lib/vscode/out/vs/code/browser/workbench/workbench-assets/` — our
  workbench CSS/JS/fonts (narrow/touch gates, fonts). Loaded by `overlays.diff`
  and `fonts.diff` patches into workbench.html. Copied onto the release after build.
- `lib/vscode/` — VS Code git submodule (pinned to the VS Code commit that
  code-server 4.118.0 uses).
- `package.json` — npm package definition (managed by pnpm from the repo root).

## Build

```bash
git submodule update --init --depth 1 lib/vscode
quilt push -a
pnpm install --frozen-lockfile
pnpm run build
VERSION=0.0.0 pnpm run build:vscode
KEEP_MODULES=1 pnpm run release
```

The release lands in `release/`. Copy `extensions/` and `workbench-assets/` onto
`release/lib/vscode/` after the build.

## Patch stack

50 patches in `patches/series`:

- Patches 1-25: code-server's own VS Code patches (from upstream, unchanged).
- Patches 26-50: our patches (code-server source patches + VS Code patches).

All patches are verbatim from the migration. See REVISIT.md at the repo root for
items to clean up (converting code-server source patches to direct edits, splitting
multi-target patches, renaming code-server to composery).

## Upstream

We have diverged from coder/code-server. We do not sync from the code-server repo.
If code-server fixes a bug we want, we read their diff and apply it manually.

The only upstream we sync from is VS Code (the git submodule). To update VS Code:

1. `cd lib/vscode && git fetch origin <new-commit> && git checkout <new-commit>`
2. `quilt push -a` — fix any broken patches
3. Rebuild
