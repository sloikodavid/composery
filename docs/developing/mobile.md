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

## What is already wired (committed)

- `eas.json` — `preview` profile (internal APK / ad-hoc builds) and `production`
  profile (store `.aab`/`.ipa`, auto-incrementing build numbers). Build numbers
  are managed server-side (`appVersionSource: remote`), so they never drift in
  git.
- `app.json` carries the store identity:
  - `ios.bundleIdentifier` / `android.package` = **`io.composery`** (the App
    Store / Play Store app ID; permanent once published, change it before first
    submit or never).
  - `version` = `1.0.0` — the **marketing version** stores key on. This is the
    source of truth; bump it here per release. (`package.json` `version` is npm
    metadata, unrelated.)
  - `ios.config.usesNonExemptEncryption: false` — answers Apple's export-
    compliance prompt up front so submits don't stall on it.
  - Camera permission string is set via the `expo-camera` plugin.

## What still needs your accounts (one-time, interactive)

These require logging in as you and cannot be committed ahead of time:

1. **Apple Developer Program** — $99/yr, recurring. Mandatory for iOS.
2. **Google Play Console** — $25, one-time.
3. **Expo account + project link** — from `packages/mobile`:
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

EAS manages signing credentials — do not hand-manage certs or keystores (the
`.gitignore` already blocks `*.p8`/`*.p12`/`*.jks`/`*.mobileprovision`). The
free EAS tier covers 30 low-priority builds/month, which is enough for our
cadence; `--local` skips the queue entirely.

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
features — QR scan, instance store, haptics, offline list — are the
justification, so keep them. Review turnaround: Apple ~1 day, Google hours to a
few days.
