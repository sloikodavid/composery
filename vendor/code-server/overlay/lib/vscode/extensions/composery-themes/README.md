# Composery themes

Composery Light and Composery Dark color themes, matching the website's warm
amber branding (see `composery-web/app/globals.css`).

This ships as a builtin extension inside Composery's code-server release. The
overlay path (`vendor/code-server/overlay/lib/vscode/extensions/`) is copied
straight into the release tree during the Docker build, so the themes are
available with no Dockerfile or `product.json` changes. `configurationDefaults`
in `package.json` makes Composery Dark the default theme on a fresh instance
(and wires the auto light/dark pair).

## Layout

- `themes/base-dark.json`, `themes/base-light.json` — VS Code Dark Modern /
  Light Modern, flattened from their `include` chain (MIT, see `NOTICE`). Treat
  as upstream: replace wholesale on a VS Code bump, don't hand-edit.
- `themes/composery-dark.json`, `themes/composery-light.json` — our retint. Each
  `include`s its base and overrides only the Composery-specific colors, so the
  brand diff stays small and reviewable. Chrome accents shift from VS Code blue
  to Composery amber and the surfaces warm to match the site; syntax
  (`tokenColors`) stays Modern for readability.

  The block marked `"//leaks"` covers a non-obvious trap: Modern declares only a
  fraction of the workbench palette and leaves the rest to VS Code's built-in
  `vs-dark` / `vs-light` registry defaults, which are **blue**. Warming the
  surfaces without overriding those leaves blue brackets, symbol icons, info
  squiggles, tab/terminal borders and selections bleeding through. We resolved
  the full registry default palette (including `transparent`/`darken`/reference
  transforms) and retinted every blue: structural accents -> amber, info
  severity -> a restrained teal so it stays distinct from amber warnings.

## Regenerating the base

The base files are upstream VS Code "Dark Modern" / "Light Modern", flattened
from their `include` chains (`dark_modern` -> `dark_plus` -> `dark_vs` and the
light equivalents) into one file each. On a VS Code bump, re-flatten those two
chains from the new upstream and overwrite the `base-*.json` files; the
`composery-*` overrides ride on top unchanged.

## Local testing

Tightest loop, from the repo root in your normal VS Code:

1. Press `F5` (the **Test Composery theme** launch config) to open an Extension
   Development Host with this extension loaded.
2. In that window: `Ctrl+K Ctrl+T` -> pick **Composery Dark** / **Composery
   Light**.
3. Edit any `themes/*.json`, then `Ctrl+R` (reload window) to see changes. Color
   tweaks apply on reload; theme picker reflects them immediately.

Alternative (loads into your daily editor): symlink the folder into your user
extensions, then reload.

```sh
# Windows (PowerShell, as admin or with developer mode):
New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.vscode\extensions\composery-themes" `
  -Target "$PWD\vendor\code-server\overlay\lib\vscode\extensions\composery-themes"
```

Note: with this installed, `configurationDefaults` only changes the default for
users who have never explicitly set `workbench.colorTheme`. If you already have a
theme set, your setting wins — pick Composery from `Ctrl+K Ctrl+T` to preview.
