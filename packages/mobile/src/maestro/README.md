# Maestro flows

End-to-end flows for the Composery mobile app. They target the native UI by
`testID` — Maestro cannot see inside a WebView, so a flow asserts the native
WebView view is visible (`instance-webview`), not the web content.

## testIDs

Every `testID` in the app, so a flow author can see what is targetable without
reading the screens. A test pins this list to the source both ways - an id
renamed out of the app, or added without landing here, fails the check.

- `add-instance-button` — empty-state CTA and header add button
- `add-instance-url-input` / `add-instance-label-input` — modal inputs
- `add-instance-submit` / `add-instance-cancel` — modal actions
- `add-instance-error` — modal validation error text
- `instance-item` — a list row
- `instance-menu-button` — per-row overflow menu
- `instance-webview` — the WebView on the instance screen
- `instance-back-missing` — back action on the not-found / load-error view
- `scan-button` — opens the QR scanner
- `scan-back` — leaves the scanner
- `scan-hint` — scanner guidance text
- `scan-torch` — torch toggle
- `scan-permission-action` — camera permission prompt action

## Which app the flows drive

`appId` is `${APP_ID}`, supplied per run, because the target differs by platform
and build: Expo Go's package id is `host.exp.exponent` on Android but
`host.exp.Exponent` on iOS, and a dev/EAS build is `io.composery` on both.
Hardcoding any one of them locks the flows to a single platform.

```sh
maestro test -e APP_ID=host.exp.exponent src/maestro/e2e.yml   # Expo Go, Android
maestro test -e APP_ID=host.exp.Exponent src/maestro/e2e.yml   # Expo Go, iOS
maestro test -e APP_ID=io.composery      src/maestro/e2e.yml   # dev or EAS build
```

CI drives the third form on both platforms - see
[`.github/workflows/mobile-e2e.yml`](../../../../.github/workflows/mobile-e2e.yml),
which builds a dev client with `expo run:*` rather than installing Expo Go, so
it does not inherit the Expo Go version pinning below.

## Running locally (Android via WSL)

Maestro on Windows runs through WSL + Java 17 + the Android SDK and can only
drive Android (iOS needs macOS). Against Expo Go:

1. Start the dev server: `pnpm --filter mobile dev`.
2. Install an Expo Go build matching the project's SDK (see `expo` in
   `package.json`) on the emulator/device.

   One Android build, **56.0.1**, rejects every SDK 56 project with "Project is
   incompatible with this version of Expo Go" — it compares the manifest's
   `sdkVersion` against its own app version rather than the SDK it supports
   (expo/expo#46846, still open at the time of writing). Later 56.0.x builds
   have shipped since that report; take the newest one and only chase this if
   you actually see that message. Any specific build is sideloadable from
   [expo/expo-go-releases](https://github.com/expo/expo-go-releases):

   ```sh
   adb install -r Expo-Go-56.0.4.apk
   ```

   Android refuses to downgrade with `-r` alone, so uninstall first when
   stepping back a version (`adb uninstall host.exp.exponent`).

3. Open the project in Expo Go on the emulator/device and let it load.
4. For `add-instance.yml` / `e2e.yml`, start from a fresh AsyncStorage (clear
   Expo Go app data) so the list is empty.
5. From WSL, with `maestro` on PATH and `ANDROID_HOME` set:

   ```sh
   export APP_ID=host.exp.exponent
   maestro test -e APP_ID=$APP_ID src/maestro/add-instance.yml
   maestro test -e APP_ID=$APP_ID src/maestro/open-instance.yml  # needs an instance
   maestro test -e APP_ID=$APP_ID src/maestro/e2e.yml
   ```
