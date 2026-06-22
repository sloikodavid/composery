#!/usr/bin/env bash
set -euo pipefail

# Once both code-server and VS Code have been built, use this script to copy
# them into a single directory (./release) and prepare the package.json and
# product.json.  The result is the Composery IDE release used by the Docker
# image; we no longer publish code-server as an NPM package.

# MINIFY controls whether minified VS Code is bundled. It must match the value
# used when VS Code was built.
MINIFY="${MINIFY-true}"

# node_modules are not copied by default.  Set KEEP_MODULES=1 to copy them.
# Note these modules will be for the platform that built them, making the result
# no longer generic.
KEEP_MODULES="${KEEP_MODULES-0}"

main() {
  cd "$(dirname "${0}")/../.."

  source ./ci/lib.sh

  VSCODE_SRC_PATH="lib/vscode"
  VSCODE_OUT_PATH="$RELEASE_PATH/lib/vscode"

  mkdir -p "$RELEASE_PATH"

  bundle_code_server
  bundle_vscode

  rsync ./docs/README.md "$RELEASE_PATH"
  rsync LICENSE "$RELEASE_PATH"
  rsync ./lib/vscode/ThirdPartyNotices.txt "$RELEASE_PATH"

  # Apply Composery-specific overlays (extensions, workbench assets, etc.).
  rsync -a ./overlay/lib/vscode/ "$VSCODE_OUT_PATH/"

  if [ "$KEEP_MODULES" = 1 ]; then
    # Copy the code-server launcher.
    mkdir -p "$RELEASE_PATH/bin"
    rsync ./ci/build/code-server.sh "$RELEASE_PATH/bin/code-server"
    chmod 755 "$RELEASE_PATH/bin/code-server"

    # Delete the extra bin scripts.
    rm "$RELEASE_PATH/lib/vscode/bin/remote-cli/code-darwin.sh"
    rm "$RELEASE_PATH/lib/vscode/bin/remote-cli/code-linux.sh"
    rm "$RELEASE_PATH/lib/vscode/bin/helpers/browser-darwin.sh"
    rm "$RELEASE_PATH/lib/vscode/bin/helpers/browser-linux.sh"
    if [ "$OS" != windows ] ; then
      rm "$RELEASE_PATH/lib/vscode/bin/remote-cli/code.cmd"
      rm "$RELEASE_PATH/lib/vscode/bin/helpers/browser.cmd"
    fi
  fi
}

bundle_code_server() {
  rsync out "$RELEASE_PATH"

  # For source maps and images.
  mkdir -p "$RELEASE_PATH/src/browser"
  rsync src/browser/media/ "$RELEASE_PATH/src/browser/media"
  mkdir -p "$RELEASE_PATH/src/browser/pages"
  rsync src/browser/pages/*.html "$RELEASE_PATH/src/browser/pages"
  rsync src/browser/pages/*.css "$RELEASE_PATH/src/browser/pages"
  rsync src/browser/robots.txt "$RELEASE_PATH/src/browser"

  # Adds the commit to package.json
  jq --slurp '(.[0] | del(.scripts,.jest,.devDependencies)) * .[1]' package.json <(
    cat << EOF
  {
    "version": "$(jq -r .codeServerVersion "./lib/vscode-reh-web-$VSCODE_TARGET/product.json")",
    "commit": "$(git rev-parse HEAD)"
  }
EOF
  ) > "$RELEASE_PATH/package.json"

  if [ "$KEEP_MODULES" = 1 ]; then
    local rsync_opts=(-a)
    if [[ ${DEBUG-} = 1 ]]; then
      rsync_opts+=(-vh)
    fi
    # If we build from source, exclude the prebuilds.
    if [[ ${npm_config_build_from_source-} = true ]]; then
      rsync_opts+=(--exclude /argon2/prebuilds)
    fi
    rsync "${rsync_opts[@]}" node_modules/ "$RELEASE_PATH/node_modules"
    # Remove dev dependencies.
    pushd "$RELEASE_PATH"
    pnpm prune --prod
    popd
  fi
}

bundle_vscode() {
  mkdir -p "$VSCODE_OUT_PATH"

  local rsync_opts=(-a)
  if [[ ${DEBUG-} = 1 ]]; then
    rsync_opts+=(-vh)
  fi

  # Some extensions have a .gitignore which excludes their built source from the
  # npm package so exclude any .gitignore files.
  rsync_opts+=(--exclude .gitignore)

  # Exclude Node since we want to place it in a directory above.
  rsync_opts+=(--exclude /node)

  # Exclude Node modules.  Note that these will already only include production
  # dependencies, so if we do keep them there is no need to do any
  # post-processing to remove dev dependencies.
  if [[ $KEEP_MODULES = 0 ]]; then
    rsync_opts+=(--exclude node_modules)
  fi

  rsync "${rsync_opts[@]}" "./lib/vscode-reh-web-$VSCODE_TARGET/" "$VSCODE_OUT_PATH"

  # Copy the Node binary.
  if [[ $KEEP_MODULES = 1 ]]; then
    cp "./lib/vscode-reh-web-$VSCODE_TARGET/node" "$RELEASE_PATH/lib"
  fi

  # Merge the package.json for the web/remote server so we can include
  # dependencies.
  jq --slurp '.[0] * .[1]' \
    "$VSCODE_SRC_PATH/remote/package.json" \
    "$VSCODE_OUT_PATH/package.json" > "$VSCODE_OUT_PATH/package.json.merged"
  mv "$VSCODE_OUT_PATH/package.json.merged" "$VSCODE_OUT_PATH/package.json"

  # Include global extension dependencies as well.
  rsync "$VSCODE_SRC_PATH/extensions/package.json" "$VSCODE_OUT_PATH/extensions/package.json"
  rsync "$VSCODE_SRC_PATH/extensions/postinstall.mjs" "$VSCODE_OUT_PATH/extensions/postinstall.mjs"
}

main "$@"
