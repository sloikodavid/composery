# Maestro flows

End-to-end flows for the Composery mobile app. They target the native UI by
`testID` — Maestro cannot see inside a WebView, so a flow asserts the native
WebView view is visible (`instance-webview`), not the web content.

## testIDs

- `add-instance-button` — empty-state CTA and header add button
- `add-instance-url-input` / `add-instance-label-input` — modal inputs
- `add-instance-submit` / `add-instance-cancel` — modal actions
- `add-instance-error` — modal validation error text
- `instance-item` — a list row
- `instance-webview` — the WebView on the instance screen
- `instance-back-missing` — back action on the not-found / load-error view

## Running (Android via WSL)

Maestro on Windows runs through WSL + Java 17 + the Android SDK and can only
drive Android (iOS needs macOS). The app uses Expo Go for development, so the
flows target `host.exp.exponent` (the Expo Go Android package id).

1. Start the dev server: `pnpm --filter mobile dev`.
2. Install Expo Go **56.0.0** on the Android emulator/device — NOT the Play
   Store/expo.dev/go "latest". Expo Go 56.0.1 (the current recommended build
   for SDK 56) rejects every SDK 56 project with "Project is incompatible with
   this version of Expo Go" due to expo/expo#46846. 56.0.0 works. Sideload it:

   ```sh
   adb install -r Expo-Go-56.0.0.apk   # from expo/expo-go-releases
   ```

   If 56.0.1 is already installed, uninstall it first (`adb uninstall
host.exp.exponent`) — Android refuses to downgrade with `-r` alone.

3. Open the project in Expo Go on the emulator/device and let it load.
4. For `add-instance.yml` / `e2e.yml`, start from a fresh AsyncStorage (clear
   Expo Go app data) so the list is empty.
5. From WSL, with `maestro` on PATH and `ANDROID_HOME` set:

   ```sh
   maestro test src/maestro/add-instance.yml
   maestro test src/maestro/open-instance.yml   # needs an instance present
   maestro test src/maestro/e2e.yml
   ```

For a development or EAS build instead of Expo Go, change `appId` to the app's
Android package. The flows are authored to run on Linux/macOS/CI as well.
