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
- When ambiguous, **keep and flag it** - favour the smaller patch surface, since
  every patched line is a potential merge conflict on the next code-server bump.

Operator-facing env vars are the one place this was taken further: every
`CODE_SERVER_*`/`CS_*` var is renamed to `COMPOSERY_*` (branding.diff),
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
| `overlay/src/browser/pages/global.css`                                  | Shared browser page baseline with the Composery auth colors and brand fonts.                                                       | Browser pages          | Browser page template, shared page class, or auth asset path changes upstream.     |
| `overlay/src/browser/pages/error.html`                                  | Minimal Composery error page using upstream error route mechanics.                                                                  | Browser error page     | Error route/template changes upstream.                                           |
| `overlay/src/browser/pages/error.css`                                   | Plain centered error page alignment.                                                                                                | Browser error page     | Error markup or class changes upstream.                                          |
| `overlay/lib/vscode/out/vs/code/browser/workbench/workbench-mobile.css` | Contains the mobile workbench viewport, stable dialog width guards, narrow quick-input guards, coarse-pointer touch guards, popup bounds, and preference editor overflow handling. | VS Code workbench CSS  | Workbench part class, widget class, or bundled workbench path changes upstream.    |
| `overlay/lib/vscode/out/vs/code/browser/workbench/workbench-mobile.js`  | Keeps side bars and the panel from crowding each other, clamps panel width, forces modal editors to stay maximized with viewport-bounded shells and compact headers on mobile, lets Back dismiss VS Code overlays, releases touchpad pinch wheel events, and bridges horizontal touch or wheel drags for narrow preference SplitViews and keybindings. | VS Code workbench DOM  | Side bar, panel, transient overlay class names, modal editor class names, preference SplitView class names, keybindings table class names, or browser wheel routing changes upstream. |
| `overlay/lib/vscode/out/vs/code/browser/workbench/workbench-fonts.css`  | Loads Inter for the workbench UI and Geist Mono for monospaced workbench contexts from bundled woff2 files.                        | VS Code workbench CSS  | Workbench HTML asset path, font files, or VS Code workbench font variables change upstream. |
| `overlay/lib/vscode/extensions/composery-themes/`                       | Builtin Composery Light/Dark color themes, contributed additively as `Composery Dark`/`Composery Light`. Self-contained flattened themes: VS Code Dark/Light Modern retinted to the website's warm amber branding (syntax `tokenColors` stay Modern). Made the true default by `default-color-theme.diff`, so no `configurationDefaults` here. | VS Code builtin extensions | Builtin extension scan path changes, or upstream Modern theme base needs reflattening on a VS Code bump. |
| `overlay/lib/vscode/extensions/composery-agents/`                       | Builtin extension registering `composery.installAgent`: opens a visible terminal and runs an agent's official setup command. `AGENTS` in `extension.js` is the single source of truth for the commands; paired with `welcome.diff` and the logos below. | VS Code builtin extensions | Builtin extension scan path changes, or an agent's official setup command changes. |
| `overlay/lib/vscode/extensions/composery-shortcuts/`                    | Builtin Shortcuts explorer view for reusable terminal, file, and folder shortcuts. Terminal shortcuts create named terminals with picked ThemeIcons/colors and resolve VS Code variables through `shortcuts.diff`. | VS Code builtin extensions | Builtin extension scan path changes, VS Code tree drag/drop APIs change, or shortcut storage schema changes. |
| `overlay/src/browser/media/agents/`                                     | Brand logos (svg) for the welcome agent cards, served via `_static`. Files are the originals; the card tints them at display time to the theme accent with a CSS mask (see `welcome.diff`). One file per agent. See the directory `NOTICE`. | Browser static media | Agent set changes, or an agent publishes an official logo. |
| `patches/branding.diff`                                                 | Merged Composery rebrand: product.json identity/links and `serverDataFolderName` (`ci/build/build-vscode.sh`); every `CODE_SERVER_*`/`CS_*` env var and the `{{CS_STATIC_BASE}}` token -> `COMPOSERY_*` (cli/http/main/wrapper); config/data/extensions dir + PWA name -> composery (util.ts/cli.ts); the product logo (`code-icon.svg`) plus editor/sessions letterpress svgs; and a forced `reloadCurrentColorTheme()` so a rebuilt theme beats the browser IndexedDB colour cache. Internal ids, the CLI binary, and upstream URLs stay code-server. | code-server build + node source + VS Code product logo/theme service | code-server's product.json jq block, env var set, `getEnvPaths`/`app-name` defaults, `code-icon.svg`/letterpress paths, or `WorkbenchThemeService` init change upstream. |
| `patches/welcome.diff`                                                  | Replaces code-server's Coder "Deploy for your team" Getting Started advert with a "Set up an AI coding agent" card: a grid of agents (logo + name, logos CSS-masked and filled with the theme accent so each reads as one accent silhouette in light and dark) whose cards dispatch `composery.installAgent` directly via the command service (the `composery-agents` builtin extension) to run each agent's official setup command in a new terminal. No `command:` href, which the page would let the browser follow. Keeps the `isEnabledCoderGettingStarted` gate. Card text truncates with ellipsis; a small `.composery-agent` hover rule (background on `gettingStarted.css`) gives a slight hover affordance (base card styles are inline in the `.ts`). | VS Code welcome page (applied after code-server's getting-started.diff) | code-server's getting-started.diff, the welcome page layout, or the agent ids/commands change. |
| `patches/auth-flow.diff`                                                | Adds first-run registration, reset-password routes, login error redirects, and the race-safe first-claim flow for password auth. | Node auth source       | Login routing, config auth, or password lifecycle changes upstream.               |
| `patches/no-generated-password.diff`                                    | Stops generating a default password in the config bootstrap so first-run setup can happen through the browser flow. | Node config bootstrap  | Default config generation or password bootstrap behavior changes upstream.         |
| `patches/persistd-readiness.diff`                                       | Gates the app on persistd readiness, extends `/healthz`, and serves a minimal neutral startup page until the workspace is ready. | Node readiness source  | Health route or request gating changes upstream.                                  |
| `patches/browser-friendly-url.diff`                                     | Reuses code-server's browser-address normalization to log the access URL cleanly on startup. | Node startup source    | Startup logging or browser open address handling changes upstream.                 |
| `patches/workbench-auth-actions.diff`                                   | Adds Reset Password alongside the existing Sign Out seam and keeps the workbench auth navigation path consistent. | VS Code/web source     | CodeServerClient, product config generation, or auth command integration changes upstream. |
| `patches/markdown-preview-loopback-callback-bridge.diff`                           | Routes only suspicious Markdown preview HTTP(S) links with explicit loopback callback targets back through VS Code's opener path and makes that preview-side handoff null-safe so the trusted-domains guard can warn instead of letting the webview bypass or crash. | Markdown preview webview | Markdown preview link handling, `openLink` messaging, preview link resolution, or preview bundle paths change upstream. |
| `patches/trusted-domains-loopback-callback-guard.diff`                  | Intercepts external HTTP(S) links whose explicit callback or redirect targets point at loopback addresses inside the trusted-domains validator, shows a sticky native warning toast with Open Anyway / Copy actions, and avoids sending browser-only workspaces into broken localhost OAuth flows. | VS Code/web source     | Trusted-domains validation, notification prompts, or external link policy changes upstream. |
| `patches/workbench-cache.diff`                                          | Revalidates workbench assets instead of serving them as effectively immutable and forces service-worker updates to bypass the browser cache. | VS Code/web source     | Static asset cache policy or service-worker registration changes upstream.         |
| `patches/workbench-mobile.diff`                                         | Loads the mobile workbench stylesheet and script from the workbench HTML entrypoint. | VS Code workbench HTML | Workbench HTML template path or asset loading changes upstream.                   |
| `patches/workbench-fonts.diff`                                          | Loads the workbench font stylesheet from the workbench HTML entrypoint.                                                            | VS Code workbench HTML | Workbench HTML template path or asset loading changes upstream.                   |
| `patches/tips.diff`                                        | Replaces the empty-editor watermark's workspace shortcut set (was just chat + Show All Commands, then a random fill from a pool including Start Debugging / Toggle Terminal) with a deterministic, non-dev-heavy set: Show All Commands, Go to File, Open Recent, Find in Files, Open Settings. | VS Code editor watermark | The watermark entry lists, the minimum-entries fill logic, or the watermark source path change upstream. |
| `patches/extensions-view-themes.diff`                                | Makes the zero-installed-extensions default gallery view show popular Themes (`category:themes @popular`) instead of all popular extensions, and renames that view from "Popular" to "Themes" so the label stays honest. Only affects the first-run state (view is gated on `!hasInstalledExtensions`); searching and the Recommended view are untouched. | VS Code extensions viewlet | `DefaultPopularExtensionsView` query, the popular view descriptor/name, or `category:`/`@popular` query handling change upstream. |
| `patches/default-layout.diff`                                | Bakes the default workbench layout for fresh browser profiles (this state otherwise lives only in browser IndexedDB) via id-keyed overrides at the points VS Code reads its defaults: default-hidden views (`viewContainerModel.ts` - Outline, Timeline, Open Editors, NPM Scripts, SCM Repositories, Extensions Recommended), default-hidden containers (`paneCompositeBar.ts` - Run and Debug, Output, Debug Console - set `visible:false`, not merely unpinned, since unpinned only moves them to the overflow), the Extensions and Terminal containers defaulting to the secondary side bar (`viewDescriptorService.ts` `views.customizations` fallback), and Accounts hidden (`globalCompositeBar.ts`). Each is overridden the moment a user changes their own layout. | VS Code views / activity-bar / panel services | View-state default computation, the composite-bar default pinned/visible logic, the `views.customizations` storage read, or the accounts-visibility default change upstream. |
| `patches/titlebar-logo.diff`                                | Makes the existing title-bar logo (`.window-appicon`, `titlebarPart.ts`) a link to `https://www.composery.io` (new tab); bumps its size from the upstream 16px to 20px; and renders it monochrome in the theme's link/accent colour (via CSS mask) on any non-Composery theme, keeping the amber product mark only when a Composery theme is active. Theme detection is a `composery-theme` class stamped on the workbench container by `workbenchThemeService.ts` (keyed on the active theme's extension id `composery.composery-themes`). | VS Code title bar / theme service | The appicon element/CSS, or the theme-apply class logic, change upstream. |
| `patches/shortcuts.diff`                                                | Registers internal `composery.shortcuts.*` workbench commands for native terminal icon picking, terminal ANSI color picking, and full VS Code variable resolution used by the `composery-shortcuts` builtin extension. | VS Code terminal workbench | `terminal.contribution.ts`, `TerminalIconPicker`, `terminalIcon.ts`, or `IConfigurationResolverService` APIs change upstream. |
| `patches/default-color-theme.diff`                          | Makes Composery the true default theme everywhere by pointing `ThemeSettingDefaults.COLOR_THEME_DARK`/`COLOR_THEME_LIGHT` (in `common/workbenchThemeService.ts`) at `Composery Dark`/`Composery Light` - the config schema reads these for `workbench.colorTheme` (web default is light, desktop dark) and for the auto light/dark preferred pair. Also recolors that file's `COLOR_THEME_DARK_INITIAL_COLORS`/`COLOR_THEME_LIGHT_INITIAL_COLORS` maps in full to the Composery theme colors (every key VS Code snapshots, generated from the theme JSONs - so the maps carry no upstream blue), so the pre-theme-load first frame is fully on-brand via VS Code's own anti-FOUC `defaultColorMap` (which keys off these same constants) - replacing the old `initialColorTheme` webClientServer hack. (The dominant fresh-container flash - the persistd "Preparing workspace" page - is handled separately in `persistd-readiness.diff`.) | VS Code theme service defaults | The `ThemeSettingDefaults` constants, the `*_INITIAL_COLORS` maps, or the first-paint `defaultColorMap` selection change upstream. |

## Update checklist

1. Update upstream version/commit.
2. Apply overlay/patches.
3. Run unit tests.
4. Run smoke tests for auth, proxy, websocket, and persistd readiness.
5. If patches are broad/conflicting, revisit fork.
