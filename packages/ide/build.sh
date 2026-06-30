#!/usr/bin/env bash
#
# Composery = pristine code-server (submodule) + our overlay + our patches.
#
#   upstream/   code-server, pinned submodule (brings its own lib/vscode)
#   overlay/    whole files we own, path-mirrored onto the tree. This includes
#               the code-server src/node files we modify (cli, http, main, util,
#               wrapper, routes/...). They are whole owned files, not patches -
#               readable and diffable directly. The two env vars that cross into
#               VS Code (CODE_SERVER_SESSION_SOCKET, CODE_SERVER_PARENT_PID) keep
#               upstream's names so code-server's own integration.diff and
#               store-socket.diff apply unmodified.
#   patches/    series = our diffs; all apply -p1 from the code-server root. These
#               are VS Code-side only (lib/vscode/*) - assets, welcome, touch/narrow,
#               branding svgs, theme cache. code-server's own 25 patches (incl.
#               integration.diff + store-socket.diff) apply unmodified from upstream.
#
# The build itself (quilt + the code-server toolchain) is Linux-only.
set -euo pipefail
export QUILT_PUSH_ARGS="--fuzz=0"   # context drift = hard failure, never a silent mis-apply

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
( cd "$BUILD" && QUILT_PATCHES=patches quilt push -a )

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
