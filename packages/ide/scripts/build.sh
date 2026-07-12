#!/usr/bin/env bash
#
# Composery = pristine code-server (submodule) + our overlay + our patches.
#
#   upstream/   code-server, pinned submodule (brings its own lib/vscode)
#   overlay/    files that do not exist upstream, path-mirrored onto the tree:
#               new server routes (src/node/routes/api, register, ...), auth pages,
#               media, bundled extensions, workbench assets. Never a modified copy
#               of an upstream file - those are patches, so upstream bumps fail
#               loudly instead of silently reverting.
#   patches/    series = our diffs; all apply -p1 from the code-server root.
#               server.diff carries every change to code-server's own src/node;
#               the rest are VS Code-side (lib/vscode/*). code-server's own
#               patches apply unmodified from upstream, before ours.
#
# The build itself (quilt + the code-server toolchain) is Linux-only.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_ROOT="$(cd "$HERE/.." && pwd)"
BUILD="${BUILD_DIR:-$PACKAGE_ROOT/build}"

echo "== 1. ensure code-server (+ its nested VS Code) is present at the pinned commit =="
# Local dev uses the submodule; Docker pre-clones upstream/ (no git context after COPY).
if [ ! -e "$PACKAGE_ROOT/upstream/package.json" ]; then
  git -C "$PACKAGE_ROOT" submodule update --init --recursive upstream
fi

echo "== 2. scratch build tree = pristine code-server (submodule stays clean) =="
rm -rf "$BUILD"; cp -r "$PACKAGE_ROOT/upstream" "$BUILD"

echo "== 3. add our VS Code-side patches to code-server's series (upstream's own apply unmodified) =="
while read -r p; do
  [ -z "$p" ] || { cp "$PACKAGE_ROOT/patches/$p" "$BUILD/patches/$p"; printf '%s\n' "$p" >> "$BUILD/patches/series"; }
done < "$PACKAGE_ROOT/patches/series"

echo "== 4. apply the whole stack (code-server's own + our VS Code-side patches), -p1, fuzz=0 =="
# --fuzz=0 must be a flag: quilt only honors QUILT_PUSH_ARGS from quiltrc files,
# so the env-var form silently applied with default fuzz. Context drift = hard
# failure, never a silent mis-apply.
( cd "$BUILD" && QUILT_PATCHES=patches quilt push -a --fuzz=0 )

echo "== 5. overlay: our whole owned files, path-mirrored =="
cp -r "$PACKAGE_ROOT/overlay/src/." "$BUILD/src/"
cp -r "$PACKAGE_ROOT/overlay/lib/vscode/extensions/." "$BUILD/lib/vscode/extensions/"

echo "== 6. rebrand the assembled IDE tree and fail on old live product names =="
node "$PACKAGE_ROOT/scripts/rebrand.mjs" "$BUILD"

echo "== 7. IDE build (npm: install -> server -> vscode -> release) =="
# Static asset URLs are keyed by product.json's "commit" (/stable-<commit>/static/...) and
# cached long-term by browsers. code-server stamps it with `git rev-parse HEAD`, assuming its
# repo commit moves when patches change - our fork pins that commit forever, so every release
# would ship different code under identical URLs and clients would keep stale caches. Stamp a
# content hash of everything we lay on top instead (asset-cache.diff makes the build honor it):
# same content = same URLs (caches stay valid), any change = new URLs everywhere.
# scripts/ is hashed too: rebrand.mjs rewrites the assembled tree, so a rename
# rule change alters shipped code without touching patches or overlay.
COMPOSERY_STATIC_STAMP=$( { (cd "$PACKAGE_ROOT" && find patches overlay scripts -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum); git -C "$PACKAGE_ROOT/upstream" rev-parse HEAD 2>/dev/null || true; } | sha256sum | cut -c1-40 )
export COMPOSERY_STATIC_STAMP
echo "static stamp: $COMPOSERY_STATIC_STAMP"
( cd "$BUILD" \
  && CI=1 npm ci \
  && npm run build \
  && VERSION="${VERSION:-0.0.0}" npm run build:vscode \
  && KEEP_MODULES=1 npm run release )

echo "== 8. output-overlay: workbench-assets into the built VS Code bundle (post-build) =="
rsync -a "$PACKAGE_ROOT/overlay/lib/vscode/out/" "$BUILD/lib/vscode/out/"
rsync -a "$PACKAGE_ROOT/overlay/lib/vscode/out/" "$BUILD/release/lib/vscode/out/"
# Upstream's release step ships only pages *.html/*.css - carry our pages JS
# (login auth.js) too, from the rebranded build tree, or the login page 404s it.
cp "$BUILD/src/browser/pages/"*.js "$BUILD/release/src/browser/pages/"

echo "Release: $BUILD/release"
