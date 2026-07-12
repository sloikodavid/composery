---
title: Mobile
description: Build and ship packages/mobile to the App Store and Play Store.
---

`packages/mobile` is the Expo Router app that wraps Composery instances in a
native shell: scan or add an instance URL, probe it, render it in a WebView. It
also emits a static web build (`web.output: static`), but the stores are the
point.

Unlike [the website](./web/index.md), there is no push-to-deploy. Two gates
sit in the path that Vercel does not have: a signed native binary must be built,
and Apple/Google must review it before users get it. [EAS](https://expo.dev)
runs that pipeline; `eas.json` configures it.

## Develop and test the app

Day-to-day: `pnpm --filter mobile dev` (Expo Go + Metro). JS/asset edits
hot-reload; this is the normal loop. An EAS **development build**
(`eas build --profile development`, see `eas.json`) is only needed when you add
a native module Expo Go doesn't bundle - not for everyday work.

Three Expo Go gotchas, recorded so nobody re-walks them:

- **The store Expo Go is behind the SDK.** As of May 2026 the App Store / Play
  Store ship Expo Go for **SDK 54**; this project is **SDK 56**. Running the
  project in a store Expo Go is JS-against-wrong-natives - the crashes look
  like random native SIGABRTs, not a clean error. Get the matching Expo Go
  instead: on Android, press `a` in the Metro terminal and Expo CLI installs
  the SDK 56 Expo Go on the connected device/emulator; on iOS it's the
  TestFlight external beta (see the
  [Expo Go / App Store notice](https://expo.dev/changelog/expo-go-and-app-store-may-2026)),
  or fall back to a development build.
- **`expo start` alone does not target Expo Go here.** Because
  `expo-dev-client` is installed, plain `expo start` prints "using development
  build" and its QR deep-links into the dev client, not Expo Go. The `dev` /
  `start` / `android` / `ios` scripts pass `--go` for this reason; keep it (or
  press `s` in the terminal to switch).
- **Native-module versions must match Expo Go exactly.** Expo Go bundles fixed
  native code, so a caret range on a native dep (`react-native-webview` was
  `^13.16.1`) lets the JS drift ahead of the natives - that skew is the
  `dataDetectorTypes` SIGABRT class above. Native deps stay pinned to what
  `npx expo install --check` expects; run it (and `npx expo-doctor`) after any
  dependency change. `@expo/dom-webview` + `@expo/metro-runtime` are direct
  deps for the same reason: expo peers on them, and pnpm otherwise reuses a
  stale transitive copy across SDK patch bumps
  ([expo#47076](https://github.com/expo/expo/issues/47076)).

Two Windows gotchas, recorded so nobody re-walks them either:

- **Don't build natively on Windows.** `expo run:android` / `eas build --local`
  fail here: the New Architecture compiles `react-native-worklets` and
  `react-native-screens` C++ from source, and the object-file paths under
  pnpm's `node_modules/.pnpm/<pkg>@<ver>_<hash>/…/.cxx/…` blow past CMake's
  250-char limit, so ninja loops with
  `manifest 'build.ninja' still dirty after 100 tries`. A short-path junction
  doesn't help (CMake resolves the real path). Build in the cloud (EAS), or on
  Linux/WSL/Mac.
- **A native crash that quits the app never reaches Metro.** It's a signal in
  the native layer, so the JS console shows nothing. Pull it from the device's
  crash store instead - this beats racing a live `logcat`:
  ```bash
  adb shell dumpsys dropbox data_app_native_crash --print   # SIGABRT/SIGSEGV stack
  adb shell dumpsys dropbox data_app_crash --print          # uncaught Java/Kotlin
  ```
  The abort message + top frames name the fault. (Example we hit: passing
  `dataDetectorTypes="none"` as a string to the WebView made Fabric's props
  parser abort casting it to a vector - fixed by passing `["none"]`.)

## What is already wired (committed)

- `eas.json` - `development` profile (dev-client APK for the loop above),
  `preview` profile (internal APK / ad-hoc builds), and `production` profile
  (store `.aab`/`.ipa`, auto-incrementing build numbers). Build numbers are
  managed server-side (`appVersionSource: remote`), so they never drift in git.
- `app.json` carries the store identity:
  - `ios.bundleIdentifier` / `android.package` = **`io.composery`** (the App
    Store / Play Store app ID; permanent once published, change it before first
    submit or never).
  - `version` = `1.0.0` - the **marketing version** stores key on. This is the
    source of truth; bump it here per release. (`package.json` `version` is npm
    metadata, unrelated.)
  - `ios.config.usesNonExemptEncryption: false` - answers Apple's export-
    compliance prompt up front so submits don't stall on it.
  - Camera permission string is set via the `expo-camera` plugin.

## What still needs your accounts (one-time, interactive)

These require logging in as you and cannot be committed ahead of time:

1. **Apple Developer Program** - $99/yr, recurring. Mandatory for iOS.
2. **Google Play Console** - $25, one-time.
3. **Expo account + project link** - from `packages/mobile`:
   ```bash
   npx eas-cli login
   npx eas-cli init        # creates the EAS project, writes extra.eas.projectId to app.json
   ```
   Commit the `projectId` it adds.

## Build and submit

From `packages/mobile`:

```bash
npx eas-cli build --platform ios --profile production
npx eas-cli build --platform android --profile production
npx eas-cli submit --platform ios       # uploads to App Store Connect
npx eas-cli submit --platform android    # uploads to Play Console
```

EAS manages signing credentials - do not hand-manage certs or keystores (the
`.gitignore` already blocks `*.p8`/`*.p12`/`*.jks`/`*.mobileprovision`). The
free EAS tier covers 30 low-priority builds/month, which is enough for our
cadence; `--local` skips the queue entirely but only on a Mac/Linux builder
(not Windows - see [Develop and test the app](#develop-and-test-the-app)).

For a quick sideloadable test build without the stores:
`npx eas-cli build --platform android --profile preview` produces an APK.

## Updating

- **JS / asset changes, no native change:** `npx eas-cli update`. Over-the-air,
  instant, no review. This is the only Vercel-like path here.
- **Anything touching native deps or the Expo SDK / runtime version:** new
  `build` + `submit` + review. There is no shortcut. Bump `app.json` `version`
  first.

## Notes on review

First submission of a new app is the slowest and strictest. Apple rejects bare
WebView wrappers under guideline 4.2 ("minimum functionality"); our native
features - QR scan, instance store, haptics, offline list - are the
justification, so keep them. Review turnaround: Apple ~1 day, Google hours to a
few days.
