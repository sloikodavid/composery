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
BUILD="${BUILD_DIR:-$HERE/build}"

echo "== 1. ensure code-server (+ its nested VS Code) is present at the pinned commit =="
# Local dev uses the submodule; Docker pre-clones upstream/ (no git context after COPY).
if [ ! -e "$HERE/upstream/package.json" ]; then
  git -C "$HERE" submodule update --init --recursive upstream
fi

echo "== 2. scratch build tree = pristine code-server (submodule stays clean) =="
rm -rf "$BUILD"; cp -r "$HERE/upstream" "$BUILD"

echo "== 3. add our VS Code-side patches to code-server's series (upstream's own apply unmodified) =="
while read -r p; do
  [ -z "$p" ] || { cp "$HERE/patches/$p" "$BUILD/patches/$p"; printf '%s\n' "$p" >> "$BUILD/patches/series"; }
done < "$HERE/patches/series"

echo "== 4. apply the whole stack (code-server's own + our VS Code-side patches), -p1, fuzz=0 =="
# --fuzz=0 must be a flag: quilt only honors QUILT_PUSH_ARGS from quiltrc files,
# so the env-var form silently applied with default fuzz. Context drift = hard
# failure, never a silent mis-apply.
( cd "$BUILD" && QUILT_PATCHES=patches quilt push -a --fuzz=0 )

echo "== 5. overlay: our whole owned files, path-mirrored =="
cp -r "$HERE/overlay/src/." "$BUILD/src/"
cp -r "$HERE/overlay/lib/vscode/extensions/." "$BUILD/lib/vscode/extensions/"

echo "== 6. code-server's own build (npm: install -> server -> vscode -> release) =="
( cd "$BUILD" \
  && CI=1 npm ci \
  && npm run build \
  && VERSION="${VERSION:-0.0.0}" npm run build:vscode \
  && KEEP_MODULES=1 npm run release )

echo "== 7. output-overlay: workbench-assets into the built VS Code bundle (post-build) =="
rsync -a "$HERE/overlay/lib/vscode/out/" "$BUILD/lib/vscode/out/"
rsync -a "$HERE/overlay/lib/vscode/out/" "$BUILD/release/lib/vscode/out/"

echo "Release: $BUILD/release"
