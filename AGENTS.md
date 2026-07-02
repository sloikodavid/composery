# Conventions

- Install deps with `pnpm install <package>@latest`, not by hand-editing package.json.
- Use `tmp/` for scratch files and artifacts (gitignored).
- No abstraction/extraction for confirmed single-use code. Dedupe shared hardcoded values so they can't drift.
- Collapse flashy or out-of-place words for consistency: Delete/Erase->Remove, Open->Start, Close->Stop, Complete/End->Finish, Spawn/Provision->Create, Mode->Type, Material->Contents, Kind->Type, Verify->Check?, Policy->Config?, Main->Index.

## IDE / code-server naming

`packages/ide/` is a hard fork of code-server (submodule at `packages/ide/upstream`). We own the fork. Split rule: files that do not exist upstream live in `packages/ide/overlay/` (path-mirrored onto the tree); every change to an upstream file is a patch in `packages/ide/patches/` (`server.diff` for code-server's `src/node`, the rest for `lib/vscode/*`), applied with quilt fuzz=0 so upstream bumps fail loudly. Never keep a modified copy of an upstream file in the overlay.

- `code-server` stays only for upstream machinery we haven't renamed: the CLI binary, build script names, env contracts the runtime image exposes (`PASSWORD`, `HASHED_PASSWORD`, `PORT`), `product.json` fields, patch names, artifact paths, and the VS Code subtree under.
  `lib/vscode/`.
- No hybrid visible names like `composery-code-server`. Visible services and supervisor programs are `composery` and `persistence`.
- The `composery` prefix is namespacing, not decoration: use `composery`/`composery-` only for identifiers injected into a shared upstream namespace (CSS classes, custom properties, DOM attributes, command/setting/contribution/extension IDs). Never on things we own outright - TS files, symbols, types, or patch filenames.
