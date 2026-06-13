# code-server customizations

## Current mode

patch-stack

## Upstream

repo: https://github.com/coder/code-server
version-source: Dockerfile `CODE_SERVER_VERSION` / `CODE_SERVER_COMMIT`
artifact-source: source build during Docker image build

## Local layout

- `patches/`: code-server source diffs appended to code-server's own quilt stack before the standalone release build; ordered by `patches/series`.
- `overlay/`: files copied over the built release tree.

## Patch ordering

Keep `patches/series`. Quilt uses it as the canonical patch order, and it makes ordering explicit even when filenames are descriptive instead of numbered.

Patch filenames should stay short and descriptive. Add new diffs to `series` in the order they must apply.

## Rules

- Keep auth/session/proxy mechanics in code-server.
- Keep container runtime/supervisor behavior outside code-server.
- Replace front-facing Composery UI only; do not blind-replace internal names (see Branding rename policy).
- Prefer overlay for static files.
- Prefer patches for source changes.
- Revisit a fork when patch stack becomes broad.

## Branding rename policy

The boundary for renaming `code-server`/`coder` to Composery, so it stays a rule
instead of a per-case decision:

- **Rename** what a browser user can see or open: UI text (product name, About,
  welcome), the PWA install name (`--app-name`), and paths a user edits
  (`~/.local/share/composery/User/settings.json`, `~/.config/composery`).
- **Keep** what only build/runtime machinery uses: the `code-server` CLI
  binary/command and its bin scripts, the build artifact names, version
  coordinates (`CODE_SERVER_VERSION/COMMIT/REPOSITORY`), IPC socket/mutex names,
  the `/tmp` scratch dir, upstream `coder/code-server` URLs, and log lines.
- When ambiguous, **keep and flag it** — favour the smaller patch surface, since
  every patched line is a potential merge conflict on the next code-server bump.

Operator-facing env vars are the one place this was taken further: every
`CODE_SERVER_*`/`CS_*` var is renamed to `COMPOSERY_*` (rebrand-env-vars.diff),
since operators set them and the originals would leak the code-server name.

Do not attempt a tree-wide find/replace: it cannot distinguish the brand name
from version coordinates and upstream URLs without a keep-list (which is this
policy), and it maximises merge drift. Keep renames targeted.

## Patch list

| File                                                                    | Purpose                                                                                                                            | Upstream area          | Revisit trigger                                                                  |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| `overlay/src/browser/pages/login.html`                                  | Minimal Composery login page using upstream login mechanics and password-manager-compatible fields.                                 | Browser login page     | Login route/template changes upstream.                                           |
| `overlay/src/browser/pages/register.html`                               | Minimal first-run password creation page for unmanaged password-auth installs.                                                     | Browser auth pages     | Password setup route/template changes.                                           |
| `overlay/src/browser/pages/reset-password.html`                         | Minimal authenticated password reset page for config-managed password-auth installs.                                               | Browser auth pages     | Password reset route/template changes.                                           |
| `overlay/src/browser/pages/auth.js`                                      | Shared auth-page behavior for hidden return URL fields, initial input-state sync, Monaco-style focus state, and Enter submission. | Browser auth pages     | Auth markup or class changes upstream.                            |
| `overlay/src/browser/pages/login.css`                                   | Shared auth page layout, Monaco input/button styling, stable error row, and accessibility-only hiding for autocomplete username fields. | Browser auth pages     | Auth markup or class changes upstream.                                           |
| `overlay/src/browser/pages/global.css`                                  | Shared black-and-white browser page baseline using system colors and default controls.                                             | Browser pages          | Browser page template or shared page class changes upstream.                      |
| `overlay/src/browser/pages/error.html`                                  | Minimal Composery error page using upstream error route mechanics.                                                                  | Browser error page     | Error route/template changes upstream.                                           |
| `overlay/src/browser/pages/error.css`                                   | Plain centered error page alignment.                                                                                                | Browser error page     | Error markup or class changes upstream.                                          |
| `overlay/lib/vscode/out/vs/code/browser/workbench/workbench-mobile.css` | Contains the mobile workbench viewport, stable dialog width guards, narrow quick-input guards, coarse-pointer touch guards, popup bounds, and preference editor overflow handling. | VS Code workbench CSS  | Workbench part class, widget class, or bundled workbench path changes upstream.    |
| `overlay/lib/vscode/out/vs/code/browser/workbench/workbench-mobile.js`  | Keeps side bars and the panel from crowding each other, clamps panel width, forces modal editors to stay maximized with viewport-bounded shells and compact headers on mobile, lets Back dismiss VS Code overlays, releases touchpad pinch wheel events, and bridges horizontal touch or wheel drags for narrow preference SplitViews and keybindings. | VS Code workbench DOM  | Side bar, panel, transient overlay class names, modal editor class names, preference SplitView class names, keybindings table class names, or browser wheel routing changes upstream. |
| `overlay/lib/vscode/extensions/composery-theme/`                        | Builtin Composery Light/Dark color themes: VS Code Dark/Light Modern retinted to the website's warm amber branding, set as the default via `configurationDefaults`. | VS Code builtin extensions | Builtin extension scan path changes, or upstream Modern theme base needs reflattening on a VS Code bump. |
| `patches/rebrand-assets.diff`                                           | Replaces the VS Code product logo (`code-icon.svg`: title-bar app icon plus banner/update/welcome) and the editor + sessions letterpress watermarks with the Composery icon. Source patch, not overlay: the minified build bundles/relocates these, so a post-build overlay of `out/` does not take. | VS Code product logo + editor/sessions watermark | `code-icon.svg`/letterpress paths or the title-bar/empty-editor markup change upstream. |
| `patches/rebrand-product.diff`                                          | Sets product.json `nameShort`/`nameLong` to "Composery" (tab, window title, About), `serverDataFolderName` to `.composery-server` (no stray `~/.vscode-server-oss`), and points report-issue/docs/license/tips/videos/newsletter links at Composery; internal ids stay code-server. | code-server build (ci/build/build-vscode.sh) | code-server's product.json jq merge block changes.                                |
| `patches/rebrand-env-vars.diff`                                         | Renames every `CODE_SERVER_*`/`CS_*` env var and the `{{CS_STATIC_BASE}}` template token code-server reads to the `COMPOSERY_*` namespace (no fallback). Paired overlay HTML uses `{{COMPOSERY_STATIC_BASE}}`. | code-server node source | code-server adds/renames env vars in cli/http/main/wrapper.                        |
| `patches/rebrand-welcome.diff`                                          | Replaces code-server's Coder "Deploy for your team" Getting Started advert with a Composery welcome card (icon, one line, docs.composery.io); keeps the `isEnabledCoderGettingStarted` gate. | VS Code welcome page (applied after code-server's getting-started.diff) | code-server's getting-started.diff or the welcome page layout changes.            |
| `patches/rebrand-theme-cache.diff`                                      | Forces one `reloadCurrentColorTheme()` after the theme service initialises, so a rebuilt Composery theme is re-read from disk and overrides the colours VS Code persists in browser IndexedDB. Without it, returning browsers keep stale theme colours until incognito/clear-site-data (the registry `added` event that normally reloads is missed for builtin themes). | VS Code theme service | WorkbenchThemeService init / reloadCurrentColorTheme changes upstream. |
| `patches/rebrand-paths.diff`                                            | Renames the config/data/extensions dir from `code-server` to `composery` (so `settings.json` lives under `~/.local/share/composery`) and defaults the PWA install name to "Composery". Paired with `rootfs/home/user/.local/share/composery/User/settings.json`. | code-server node source (util.ts, cli.ts) | code-server's `getEnvPaths` or `app-name` default changes.                        |
| `patches/auth-flow.diff`                                                | Adds first-run registration, reset-password routes, login error redirects, and the race-safe first-claim flow for password auth. | Node auth source       | Login routing, config auth, or password lifecycle changes upstream.               |
| `patches/no-generated-password.diff`                                    | Stops generating a default password in the config bootstrap so first-run setup can happen through the browser flow. | Node config bootstrap  | Default config generation or password bootstrap behavior changes upstream.         |
| `patches/persistd-readiness.diff`                                       | Gates the app on persistd readiness, extends `/healthz`, and serves a minimal neutral startup page until the workspace is ready. | Node readiness source  | Health route or request gating changes upstream.                                  |
| `patches/browser-friendly-url.diff`                                     | Reuses code-server's browser-address normalization to log the access URL cleanly on startup. | Node startup source    | Startup logging or browser open address handling changes upstream.                 |
| `patches/workbench-auth-actions.diff`                                   | Adds Reset Password alongside the existing Sign Out seam and keeps the workbench auth navigation path consistent. | VS Code/web source     | CodeServerClient, product config generation, or auth command integration changes upstream. |
| `patches/markdown-preview-loopback-callback-bridge.diff`                           | Routes only suspicious Markdown preview HTTP(S) links with explicit loopback callback targets back through VS Code's opener path and makes that preview-side handoff null-safe so the trusted-domains guard can warn instead of letting the webview bypass or crash. | Markdown preview webview | Markdown preview link handling, `openLink` messaging, preview link resolution, or preview bundle paths change upstream. |
| `patches/trusted-domains-loopback-callback-guard.diff`                  | Intercepts external HTTP(S) links whose explicit callback or redirect targets point at loopback addresses inside the trusted-domains validator, shows a sticky native warning toast with Open Anyway / Copy actions, and avoids sending browser-only workspaces into broken localhost OAuth flows. | VS Code/web source     | Trusted-domains validation, notification prompts, or external link policy changes upstream. |
| `patches/workbench-cache.diff`                                          | Revalidates workbench assets instead of serving them as effectively immutable and forces service-worker updates to bypass the browser cache. | VS Code/web source     | Static asset cache policy or service-worker registration changes upstream.         |
| `patches/workbench-mobile.diff`                                         | Loads the mobile workbench stylesheet and script from the workbench HTML entrypoint. | VS Code workbench HTML | Workbench HTML template path or asset loading changes upstream.                   |

## Update checklist

1. Update upstream version/commit.
2. Apply overlay/patches.
3. Run unit tests.
4. Run smoke tests for auth, proxy, websocket, and persistd readiness.
5. If patches are broad/conflicting, revisit fork.
