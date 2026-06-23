# Conventions

- Install deps with `pnpm install <package>@latest`, not by hand-editing package.json.
- Use `tmp/` for scratch files and artifacts (gitignored).
- No abstraction/extraction for confirmed single-use code. Dedupe shared hardcoded values so they can't drift.
- Collapse flashy or out-of-place words for consistency: Delete/Erase→Remove, Open→Start, Close→Stop, Complete/End→Finish, Spawn/Provision→Create, Mode→Type, Material→Contents, Kind→Type, Verify→Check?, Policy→Config?, Main→Index.

## IDE / code-server naming

`packages/ide/` is a hard fork of code-server (submodule at `packages/ide/upstream`). We own the fork; the overlay lives at `packages/ide/overlay/`. VS Code source sits at `packages/ide/{overlay,upstream}/lib/vscode/`.

- `code-server` stays only for upstream machinery we haven't renamed: the CLI binary, build script names, env contracts the runtime image exposes (`PASSWORD`, `HASHED_PASSWORD`, `PORT`), `product.json` fields, patch names, artifact paths, and the VS Code subtree under
`lib/vscode/`.
- No hybrid visible names like `composery-code-server`. Visible services and supervisor programs are `composery` and `persistence`.
- The `composery` prefix is namespacing, not decoration: use `composery`/`composery-` only for identifiers injected into a shared upstream namespace (CSS classes, custom properties, DOM attributes, command/setting/contribution/extension IDs). Never on things we own outright — TS files, symbols, types, or patch filenames.
