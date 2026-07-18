# Composery Themes

Composery Light and Composery Dark color themes match the shared brand palette
in `packages/shared/index.ts`.

This ships as a builtin extension inside the Composery IDE release. The
path (`packages/ide/overlay/lib/vscode/extensions/`) is copied straight into the
release tree during the build, so the themes are available with no Dockerfile or
`product.json` changes.

## Layout

- `themes/composery-dark.json`, `themes/composery-light.json` - VS Code
  Dark/Light Modern retints with Composery-specific workbench colors. Syntax
  `tokenColors` stay Modern for readability. Hand-authored; the "default color
  theme" tests in `tests/code-server-patches.test.ts` guard their overlap with
  the brand palette.
- The theme colors should stay symmetric: every chrome key one theme retints,
  the other should too.
- The first-paint color snapshot in
  `packages/ide/patches/default-color-theme.diff` mirrors these theme files so
  browser startup does not flash stale colors; the same tests fail if the
  patch and the themes drift apart, so update both together.

## Local Testing

1. Press `F5` (the **Test Composery theme** launch config) to open an Extension
   Development Host with this extension loaded.
2. In that window: `Ctrl+K Ctrl+T` -> pick **Composery Dark** or
   **Composery Light**.
3. Edit any `themes/*.json`, then `Ctrl+R` (reload window) to see changes.

Note: with this installed, users who already set `workbench.colorTheme` keep
their chosen theme.
