---
title: Development
description: Run, check, build, and test Composery Mobile locally and in CI.
---

## Fresh clone

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter mobile check
pnpm --filter mobile build
```

The mobile package is part of the root `pnpm check` and `pnpm build` gates. Add
dependencies with `pnpm --filter mobile install <package>@latest`; for an Expo
native module, run `pnpm --filter mobile exec expo install --check` afterward
and keep the SDK-compatible version Expo selects.

## JavaScript loop

```sh
pnpm --filter mobile dev
```

This explicitly targets Expo Go. Press `a` in the Metro terminal to open the
matching Android Expo Go build on a connected emulator/device. iOS native
development requires macOS. Use an EAS preview APK when Expo Go does not match
the behavior being investigated.

Do not add `expo-dev-client` merely to run ordinary JavaScript changes. Native
nightly CI builds the Release configuration, which is closer to the store
artifact and avoids development-only network services and permissions.

## Checks

```sh
pnpm --filter mobile exec expo install --check
pnpm --filter mobile exec expo-doctor
pnpm --filter mobile check
```

`check:native-config` runs Expo config introspection and checks the generated
manifest/plist. When intentionally changing a permission or transport rule,
change the app config and its assertion together, then prove the assertion can
fail by feeding it a deliberately altered introspection artifact.

## Local test instance

The Maestro flow needs a real endpoint that identifies itself as Composery.
Start the disposable fixture:

```sh
node packages/mobile/scripts/test-instance.mjs
```

- Android emulator URL: `http://10.0.2.2:4173`
- iOS simulator URL: `http://127.0.0.1:4173`
- Physical phone URL: the workstation's LAN address on port `4173`

Never use this fixture for store review or production. It exists only to make
native tests deterministic.

## Android live testing

Use the repository helper from the root:

```sh
node .agents/skills/android-live-test/scripts/android.mjs status
node .agents/skills/android-live-test/scripts/android.mjs boot
```

For a physical phone, enable Developer options and Wireless debugging, then use
the helper's `pair` and `connect` commands with the values shown by Android.
Never clear or uninstall a physical device app without the owner's permission.

Nightly CI builds and installs the Release configuration on Android and iOS,
then runs `src/maestro/e2e.yml`. Maestro can assert the native WebView exists,
but cannot inspect its document. WebView behavior therefore also has unit tests
for navigation classification and must be exercised manually for touch,
keyboard, external-link, login, and local-network paths.

Cloud sign-in has one intentional exception to the ordinary external-link
rule. The box first records its PKCE transaction in the main IDE WebView, then
the Composery authorization page opens in a separate full-screen WebView. That
view shares the platform cookie store so the one-time callback can return to
the box, but receives none of the IDE WebView's injected scripts or native
bridge. Test successful **Continue with Composery**, password recovery, cancel,
and failed authorization on both platforms; every unrelated cross-origin link
must still open through the operating system.

## Preview APK

Check login and project linkage, then build:

```sh
pnpm --filter mobile eas -- whoami
pnpm --filter mobile eas -- project:info
pnpm --filter mobile eas -- build --platform android --profile preview
```

EAS prints a build page and an APK download link. Download it on the phone or
use `adb install -r <apk>`. A preview APK is for testing, not the GitHub public
release: once Play App Signing exists, the public APK comes back from Google so
its certificate matches Play installs.

## Camera behavior to check on a device

1. Start **Scan QR code**. The OS prompt appears only after this user action.
2. Deny once. The scanner explains why camera access is used and retains Back
   and **Enter URL instead**.
3. Choose **Allow camera** and scan a valid Composery QR.
4. Deny permanently. The action changes to **Open settings**.
5. Grant access in system settings and return. The screen re-reads permission
   on foreground and starts the camera without being reopened.
6. Confirm Android Settings lists Camera only under app permissions.

## Windows native builds

Windows is supported for the JavaScript loop, checks, Android device control,
and EAS cloud builds. Do not use `eas build --local` for iOS; it requires macOS.
If a local Android CMake build fails under pnpm's long native dependency paths,
use EAS or a Linux builder rather than weakening the project layout.
