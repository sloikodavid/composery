# Plan — Composery Mobile App

A thin native client for Composery: an instance list plus a WebView wrapper per
instance. It is **not** a native terminal or agent app. You add a Composery by
URL (self-hosted or Cloud), tap it, and the existing web UI — login, editor,
terminal, agents — runs inside a WebView exactly as it does in a browser. The
app adds no new server surface; the Composery automation API (`/v1`) is
untouched.

Target: iOS and Android, Expo SDK 56, Expo Go for development (no development
build required for v1).

> **Read this whole file before writing code.** The skeleton in `packages/mobile-app/`
> is already scaffolded and verified — do **not** re-run `create-expo-app` or
> re-install Expo. Modify the existing package in place. Run `pnpm check` (root)
> and `npx expo-doctor` (from `packages/mobile-app`) early and often.

## Status — verified skeleton already in place

`packages/mobile-app/` exists with the Expo SDK 56 default template, the two
real deps installed, and the toolchain empirically verified (not assumed):

- Expo 56.0.12, React Native 0.85.3, React 19.2.3, Expo Router 56.2.11,
  `@expo/ui` 56.0.18. Typed routes + React Compiler on by default.
- `react-native-webview@13.16.1` and
  `@react-native-async-storage/async-storage@2.2.0` installed at the
  **SDK-pinned versions bundled in Expo Go** (see Wrinkle 1).
- `npx expo-doctor` passes 21/21.
- **pnpm isolated deps work** — no `nodeLinker: hoisted` needed. Expo installs
  cleanly under the existing `packages/*` workspace without touching the docs
  site or the vendored code-server build.
- App rebranded: name `Composery`, slug `composery`, deep-link scheme `composery`.
- Files are reformatted to repo style (tabs, no trailing commas).
- Mobile-app is **excluded** from the root type-checked-TS ESLint config and
  from the root `tsc` (it has its own tsconfig extending `expo/tsconfig.base`).
  Its own lint/typecheck/test are wired into root `check` (see Execution step 8
  and the Testing section — finish that wiring as part of the plan).
- Root `check` currently passes: `eslint .`, `pnpm --filter docs-website lint`,
  root `tsc --noEmit`, `prettier --check .`, `node scripts/tree.mjs`.

The template's demo UI (tabs, `explore`, animated icon, themed components,
`global.css`) is still present and **must be deleted** in Execution step 1,
then replaced with the screens below.

## Verified facts (June 2026)

| Question                                               | Answer                                                                                                                 | Source                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Current Expo SDK                                       | 56.0.12 stable (RN 0.85.3, React 19.2.3); SDK 57 canary only                                                           | expo.dev/changelog/sdk-56                                    |
| New Architecture                                       | Mandatory since SDK 55; legacy bridge removed                                                                          | Expo docs                                                    |
| `react-native-webview` in Expo Go                      | Yes, bundled 13.16.1                                                                                                   | docs.expo.dev/versions/latest/sdk/webview                    |
| `@react-native-async-storage/async-storage` in Expo Go | Yes, bundled 2.2.0                                                                                                     | docs.expo.dev/versions/latest/sdk/async-storage              |
| `expo-secure-store` in Expo Go                         | Yes (biometric `requireAuthentication` unsupported in Go)                                                              | docs.expo.dev/versions/latest/sdk/securestore                |
| `@react-native-cookies/cookies` in Expo Go             | No — third-party native module, forces a dev build                                                                     | Expo FAQ + dev-builds intro                                  |
| Composery auth cookie                                  | `code-server-session` (or `…-<suffix>`), value = hashed password, **session cookie — no `Max-Age`/`Expires`**          | `packages/ide/overlay/src/node/http.ts:305 getCookieOptions` |
| iOS session-cookie persistence                         | WKWebView drops session cookies when iOS fully kills the app; Android CookieManager persists them                      | WKWebView/CookieManager behavior                             |
| code-server URL params                                 | `?folder=` then `?workspace=` (priority order) then CLI arg then last-opened — **must be preserved**                   | code-server FAQ                                              |
| code-server behind reverse proxy                       | Supports subpaths (Caddy `uri strip_prefix`, nginx) — **pathname is meaningful, must be preserved**                    | code-server guide                                            |
| React Native color parsing                             | `StyleSheet`/`processColor` accepts hex, rgb/rgba, hsl/hsla, named colors — **not `oklch`**                            | reactnative.dev/docs/colors                                  |
| Hermes globals                                         | `crypto.randomUUID` and `DOMException` are **not** available on Hermes                                                 | livekit client-sdk-js issue #1871                            |
| Maestro on Windows                                     | Officially via WSL + Java 17 + Android SDK (Android only); iOS needs macOS                                             | maestro.dev docs                                             |
| Headless compile proxy                                 | `npx expo export --platform android` bundles to Hermes bytecode with no device — use it as the "does it compile" check | verified locally                                             |

## App shape

```
packages/mobile-app/src/
  app/
    _layout.tsx          Stack root.
    index.tsx            Instance list, or empty/onboarding state.
    add-instance.tsx    Modal: URL + optional label.
    instance/[id].tsx   The WebView screen for one instance.
  lib/
    normalize-url.ts     Pure: validate + normalize an instance URL. NO React Native imports.
    instance-store.ts   Pure list reducers + a thin AsyncStorage adapter. Pure part: NO RN imports.
    id.ts                Tiny id generator (Hermes has no crypto.randomUUID — see Wrinkle 4).
    theme.ts             Composery token palette as hex (oklch converted — see Wrinkle 3).
  maestro/               Maestro YAML flows (see Testing — author even if you can't run them on Windows).
```

Navigation: `index` (list) → `instance/[id]` (WebView). `add-instance` is a
modal presented from `index`. Typed routes are on, so
`router.push({ pathname: "/instance/[id]", params: { id } })` is type-checked.

The app does **nothing** for authentication. The WebView loads the Composery
URL; if the session is not authenticated, Composery renders its own login page,
the user enters the password, Composery sets `code-server-session`, and the
WebView stays logged in. The app never sees the password or the cookie value.

## Module design (deep modules)

### `normalizeInstanceUrl` — pure, RN-free

The only place URL rules live. Callers pass raw user input; callers receive a
`URL` object and cannot misuse a raw string. **No React Native imports** —
this file is exercised by Vitest in plain Node.

```ts
// normalizeInstanceUrl(input: string): URL
// - throws on non-http(s) scheme (reject file:, custom schemes, bare strings with no host)
// - if no scheme but a host is present, prepend https://
// - lowercase the host (case-insensitive); leave path/query/hash case alone
// - preserve pathname (subpath-hosted instances), search (?folder=/?workspace=), and hash
// - collapse repeated leading slashes in the pathname to one; keep trailing slashes (/code vs /code/ matters)
// - reject URLs containing credentials (user:pass@)
```

No query-param-specific code — the standard `URL` preserves `?folder=` for free.
The store holds `url.href` from the returned `URL`; the WebView loads
`url.href`. Self-hosted (any domain/port/subpath) and Cloud flow through
identically.

### `InstanceStore` — pure reducers + AsyncStorage adapter

Hides persistence and id generation. **The pure-reducer file has no React
Native imports** so it is testable in Vitest without RN polyfills. The
AsyncStorage adapter is the only RN-touching part and is injected as a port
(tests pass a fake in-memory map).

```ts
type Instance = {
	id: string;
	label: string;
	url: string; // normalizeInstanceUrl(input).href
	createdAt: number;
	lastOpenedAt?: number;
};

// Pure reducers (tested without AsyncStorage, no RN imports):
//   add(list, input: { url: string; label?: string }, id: () => string, now: () => number): Instance
//   remove(list, id): Instance[]
//   touch(list, id, now: () => number): Instance[]
//   get(list, id): Instance | undefined
//
// Effects (thin adapter over AsyncStorage, key "composery.instances"):
//   loadAll(): Promise<Instance[]>
//   persist(list): Promise<void>
```

Inject `id` and `now` so reducers are deterministic in tests. The store holds
only URLs and labels — **no secrets**. The session cookie lives inside the
WebView's own cookie store; the app never touches it. So AsyncStorage
(unencrypted) is correct here, and `expo-secure-store` is not needed in v1.

### `id.ts`

Hermes has no `crypto.randomUUID` (Wrinkle 4). Use a small, dependency-free
generator, e.g. `Date.now().toString(36) + Math.random().toString(36).slice(2, 8)`.
Good enough for a local instance list (not a security id).

### `theme.ts` — hex, not oklch

React Native does not parse `oklch()` (Wrinkle 3). Convert the docs-website
oklch palette to hex once, in this file, as plain `const` tokens (e.g.
`export const colorPrimary = "#9a6b3f"`). Derive the hex from the docs-website
oklch values in `packages/docs-website/src/app/global.css` (the warm-amber
palette: `--color-fd-primary: oklch(0.55 0.12 64)` light / `0.6 0.14 64` dark,
etc.). Use these tokens via `StyleSheet.create` — **do not add NativeWind**
(its v5 is still pre-release; v4 targets Tailwind 3; either would add a
destabilizing dependency for a handful of colors).

### `instance/[id].tsx` — the WebView screen

```tsx
<WebView
	ref={webviewRef}
	source={{ uri: instance.url }}
	sharedCookiesEnabled // iOS: use WKHTTPCookieStore
	thirdPartyCookiesEnabled // Android: CookieManager
	javaScriptEnabled // code-server needs JS
	domStorageEnabled // Android
	renderLoading={LoadingView}
	onShouldStartLoadWithRequest={guard} // see Navigation guard — mind the iOS initial-load quirk
	onNavigationStateChange={syncBack} // track canGoBack for hardware back
	testID="instance-webview" // for Maestro
/>
```

- **Navigation guard** (`onShouldStartLoadWithRequest`): return `true` to allow,
  `false` to block. **iOS fires this for the initial main-frame load too** — a
  naive "block everything not on the instance host" guard will block the
  initial navigation and show a blank screen. So: allow the request when its
  URL is the instance's own origin **or** it is the very first load
  (`navigationType === 'other'` / the initial `source` URL). For subsequent
  top-frame navigations to a _different_ host (Ports-panel proxy links,
  extension marketplace, docs), open them in the system browser via
  `expo-web-browser`'s `openBrowserAsync` and return `false` to block in-WebView.
  Sub-frame/resource requests to other hosts (CDNs, fonts) must be allowed
  (`return true`) or the page breaks — only intercept **top-frame** navigations.
- **Back**: Android hardware back goes back in-WebView when `canGoBack`, else
  pops to the list. Use `BackHandler` from `react-native` in a `useEffect`.
- **Native chrome**: a top bar with ← (back to list), instance label, and a
  menu (reload, open in browser, remove). Use `Alert` or a simple sheet for the
  menu — keep it dependency-free. No pull-to-refresh (reloading an SPA workbench
  is jarring); a reload button instead.
- **Cookie props**: `sharedCookiesEnabled` + `thirdPartyCookiesEnabled` make
  Android persistence free and iOS in-session behavior consistent. See Cookie
  behavior below for the iOS hard-kill limitation.

## Cookie & session behavior

Composery's `code-server-session` cookie is a **session cookie** (no
`Max-Age`/`Expires`). Consequence:

- **Android**: `CookieManager` persists session cookies to disk → the user
  stays logged in across app-kills for free.
- **iOS**: `WKHTTPCookieStore` drops session cookies when iOS **fully kills**
  the app → the user re-enters the password after a hard kill. Normal
  backgrounding is fine.

**v1 decision: accept iOS re-login-after-hard-kill as a documented limitation.**
It matches web-browser semantics (browsers also drop session cookies when fully
closed) and Composery's own posture. No new native modules, Expo Go preserved.
The cookie-restore seam (capture the cookie to `expo-secure-store`, re-inject on
cold start via `@react-native-cookies/cookies`) is a deliberate future feature —
it forces a development build, so it is out of scope for v1. **Do not add it.**

## Testing strategy

### Pure logic — Vitest, mobile-app-local

`normalizeInstanceUrl` and `InstanceStore` reducers are pure TS with **no
React Native imports**, so they run in Vitest in plain Node. Set up:

- `packages/mobile-app/vitest.config.ts`:
  ```ts
  import { defineConfig } from "vitest/config";
  export default defineConfig({
  	test: { include: ["src/**/*.test.ts"], environment: "node" },
  	resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } }
  });
  ```
  (Vitest is already resolvable from the workspace root; no need to add it as
  a mobile-app dep. The `@` alias mirrors `tsconfig.json` `paths`.)
- `packages/mobile-app/package.json` — add `"test": "vitest run"` to `scripts`.
- Wire into root `check`: append `&& pnpm --filter mobile-app test` to the
  root `check` script. Also append
  `&& pnpm --filter mobile-app exec tsc --noEmit` so mobile-app typecheck runs
  in `check` (root `tsc` does not cover it).
- The store tests use a **fake AsyncStorage** (in-memory `Map`) injected as the
  storage port — no mocking of the app's own modules, no RN polyfills.

### `normalizeInstanceUrl` scenarios (each asserts the exact `href`)

bare `mybox.com` → `https://mybox.com/`; `https://mybox.com/?folder=/app` →
unchained; `http://localhost:8080`; `https://host/code/` (subpath preserved);
`https://host:8443/code/?folder=/home/user` (port + subpath + query preserved);
`ftp://x` (reject); `user:pass@host` (reject); `https://MyBox.com/Path`
→ host lowercased, path case preserved; trailing-slash preservation
(`/code` vs `/code/`).

### E2E — Maestro YAML (author even if you can't run them)

Maestro flows live in `packages/mobile-app/src/maestro/` as YAML. **On Windows,
Maestro requires WSL + Java 17 + Android SDK and can only test Android** (iOS
needs macOS). If you don't have WSL set up, still **write** the flows (they're
just YAML) and run them when a Linux/macOS CI runner or a Mac is available.
Add `testID`s to the key elements (`instance-webview`, list items, the add
button, the URL input) so the flows can target them.

Maestro **cannot see inside a WebView** — it can assert the native WebView view
is visible (by `testID`), not the web content. So flows assert: app launches →
list visible → add an instance by URL → it appears in the list → tap it → the
`instance-webview` is visible. Do not write flows that assert on Composery's
inner web UI.

### Manual / device verification (the parts Vitest + Maestro can't cover)

The WebView screen rendering a real Composery must be verified on a device.
Headless proxy for "the bundle compiles": `npx expo export --platform android`
(produces the Hermes bytecode bundle with no device — use it in CI/locally as
the compile gate). The actual render check needs Expo Go on a phone or an
Android emulator: `npx expo start` → scan QR → add an instance URL → confirm
the Composery login page loads inside the WebView.

## Wrinkles & gotchas (all verified — read before coding)

1. **Use `npx expo install <pkg>`, never `pnpm add <pkg>@latest`, for native
   modules.** `pnpm add @latest` pulled webview 14.0.1 / async-storage 3.1.1,
   which are **not** the Expo Go–bundled versions and silently break Expo Go.
   `npx expo install` consults the SDK version map and installs via pnpm at the
   workspace root. After any native dep change, re-run `npx expo-doctor` and
   require 21/21. For pure-JS devDeps (e.g. a vitest plugin), `pnpm --filter
mobile-app add -D <pkg>` is fine.
2. **`expo-env.d.ts` is gitignored and auto-generated** by `expo start` /
   `expo export` / `expo prebuild`. Mobile-app `tsc --noEmit` fails on a fresh
   clone until Expo regenerates it. Before running `tsc` (in CI or locally on a
   fresh clone), run `npx expo export --platform android` once (it regenerates
   `expo-env.d.ts` as a side effect and doubles as the compile gate). This gap
   mostly disappears once the demo files are deleted in step 1, but the
   ordering rule stays: generate `expo-env.d.ts` before typechecking.
3. **pnpm isolated deps are fine** — verified. Do **not** add
   `nodeLinker: hoisted`; it would hoist the entire workspace (blast radius:
   docs site + vendored code-server build) for no benefit.
4. **Hermes has no `crypto.randomUUID` (and no `DOMException`).** Do not call
   `crypto.randomUUID()` from the app. Use the tiny `id.ts` generator. If a
   dependency later needs these globals, polyfill at the app entry — not a v1
   concern.
5. **React Native does not parse `oklch()`.** `theme.ts` must hold **hex**
   colors converted from the docs-website oklch tokens. Do not pass oklch
   strings to `StyleSheet`.
6. **`onShouldStartLoadWithRequest` fires for the initial main-frame load on
   iOS.** A guard that blocks "any non-instance-host request" will blank the
   screen on first paint. Allow the instance origin **and** the initial load;
   only intercept subsequent **top-frame** navigations to other hosts, and
   allow sub-frame/resource cross-origin requests through.
7. **Maestro cannot see inside a WebView.** Assert the native WebView is
   visible by `testID`, not inner web content.
8. **Maestro on Windows needs WSL.** Author flows regardless; run them on
   Linux/macOS/CI. Don't block the build on running them locally on Windows.
9. **`normalizeInstanceUrl` must preserve query params and subpaths.**
   code-server reads `?folder=`/`?workspace=` and supports reverse-proxy
   subpaths. "Clean URL" means validate + normalize, not strip to origin.
10. **Do not add NativeWind.** Use `StyleSheet` + the hex `theme.ts` tokens.
    NativeWind v5 is pre-release; v4 targets Tailwind 3 — either destabilizes a
    pure-WebView app for no gain.
11. **Do not add iOS cookie persistence / `@react-native-cookies/cookies`.**
    It forces a development build and breaks the Expo Go workflow. v1 accepts
    iOS re-login-after-hard-kill (documented).
12. **No new server surface.** The app drives only the web UI through a
    WebView. The `/v1` API, the WS auth-header problem, and the Rust/TS
    key-store contract are all out of scope.
13. **Prettier** covers `packages/mobile-app/**`; keep files tab-indented,
    no trailing commas (repo config). Run `pnpm fix` to auto-format.
14. **Template demo files to delete in step 1**: `src/app/explore.tsx`,
    `src/components/animated-icon.*` (incl. `.module.css` and `.web.tsx`),
    `src/components/app-tabs.*`, `src/components/themed-text.tsx`,
    `src/components/themed-view.tsx`, `src/components/hint-row.tsx`,
    `src/components/web-badge.tsx`, `src/components/ui/collapsible.tsx`,
    `src/constants/theme.ts`, `src/global.css`, `src/hooks/use-color-scheme.*`,
    `src/hooks/use-theme.ts`, `scripts/reset-project.js`, and the template
    asset images under `assets/images/` (replaced in step 7). Keep
    `assets/images/` structure for the Composery icons.
15. **Deep-link scheme `composery`** is registered but unused in v1 (onboarding
    is URL-only). QR scan (future) will use it or encode a URL directly.
16. **Renovate**: `expo-*` packages use `~56.0.x` (tilde); patch/minor bumps
    within SDK 56 are safe. A major bump (→ SDK 57) requires
    `npx expo install --fix` to re-pin every native module — handle manually on
    the next SDK jump, don't let Renovate auto-merge it.
17. **The Composery UI already has mobile support** (`touchGate.ts` /
    `narrowGate.ts` in the IDE overlay use `matchMedia`, which works inside
    WKWebView/Android WebView). So touch/narrow modes apply inside the WebView
    for free — the app does not need to replicate them.

## Execution order (vertical slices, RED → GREEN each)

Run, after each slice: `pnpm --filter mobile-app exec tsc --noEmit`,
`pnpm --filter mobile-app test` (from slice 2 on), `pnpm --filter mobile-app
exec expo-doctor` (if native deps changed), `npx expo export --platform
android` (the headless compile gate), `pnpm fix`, and `pnpm check` (root).

1. **Strip demo files** (Wrinkle 14) **+ replace `_layout.tsx` with a Stack**.
   Headless gate: `npx expo export --platform android` succeeds. (Booting in
   Expo Go is the manual device check — see Manual verification.)
2. **`normalize-url.ts` + `id.ts` + Vitest setup** (`vitest.config.ts`,
   `test` script) + tests (scenarios above). Wire `pnpm --filter mobile-app
test` and `pnpm --filter mobile-app exec tsc --noEmit` into root `check`.
3. **`theme.ts`** (hex tokens converted from the docs-website oklch palette).
4. **`instance-store.ts`** (pure reducers + AsyncStorage adapter) + tests with
   a fake storage.
5. **`index.tsx` instance list** (empty/onboarding + populated states) wired
   to the store. Add `testID`s for Maestro.
6. **`add-instance.tsx` modal** (URL input → normalize → optional label) wired
   to the store. Tests cover the invalid-URL reject path and the valid add path.
7. **`instance/[id].tsx` WebView screen** (load URL, cookie props, navigation
   guard per Wrinkle 6, back handling, native chrome, `testID`). This is the
   slice that needs the manual device check — hand off `npx expo start` + a
   instance URL and confirm the Composery login page renders in the WebView.
8. **Rebrand icons + splash** to the Composery amber mark. Source mark:
   `packages/ide/overlay/src/browser/media/composery-logo.svg` (and
   `favicon.svg`). Generate the Expo-required PNGs (icon, Android adaptive
   foreground/background/monochrome, splash-icon, favicon) at the sizes
   `app.json` references, using `sharp` (already a root devDep) — adapt
   `scripts/generate-icons.mjs`. Update `app.json` splash `backgroundColor` to
   the Composery amber hex. Drop the template's blue `#208AEF`.
9. **Set up mobile-app lint**: install `eslint` + `@expo/eslint-config` as
   mobile-app devDeps (`pnpm --filter mobile-app add -D eslint @expo/eslint-config`),
   set the `lint` script to `eslint .`, and wire `pnpm --filter mobile-app lint`
   into root `check` (do this last so check stays green through slices 1–8).

## Out of scope for v1 (future)

- QR scan to add an instance (TODO.md).
- iOS cookie persistence across hard-kill (requires `@react-native-cookies/cookies`
  → development build).
- Biometric lock, push notifications, native share.
- EAS Build/Submit production profiles + first store builds.
- Composery Cloud account/instance-lifecycle client (the control-plane API
  does not exist yet; the app speaks to each instance directly by URL).
- Native terminal / agent control surface.

## Notes for the implementing agent

- You are working in a pnpm workspace; the root is `C:\Users\sloik\Documents\Projects\composery`.
  The mobile app is `packages/mobile-app`. The repo's conventions are in
  `AGENTS.md` (pnpm, tabs, no trailing commas, no `nodeLinker: hoisted`).
- `prompts/TREE.md` is the canonical file tree; regenerate with `pnpm fix`
  after adding/removing files. Do not edit it by hand.
- The repo pins `packageManager: pnpm@11.7.0` via corepack. Node v22 is
  installed. Expo SDK 56 needs Node ≥ 20.19.4.
- When a slice changes `app.json` or adds/removes files, run `pnpm fix` so
  `prompts/TREE.md` stays in sync (the root `check` enforces it).
- If `npx expo start` is unavailable in your environment, the headless
  compile gate (`npx expo export --platform android`) is your substitute for
  "it builds." The render check is a human/device step.
