# Maestro flows

The flows drive native UI by `testID`. Maestro can assert that the native
WebView exists, but cannot inspect its document; unit tests and manual device
checks cover the WebView navigation boundary.

## Test IDs

- `add-instance-button`: empty-state/header add action
- `add-instance-url-input` / `add-instance-label-input`: form inputs
- `add-instance-submit` / `add-instance-cancel`: form actions
- `add-instance-error`: form error
- `instance-item`: instance row
- `instance-menu-button`: instance overflow action
- `instance-webview`: verified instance WebView
- `cloud-authorization-webview`: isolated Composery account sign-in WebView
- `cloud-authorization-back`: cancel cloud authorization
- `instance-back-missing`: missing-instance back action
- `scan-button`: QR scanner action
- `scan-back`: scanner back action
- `scan-hint`: scanner guidance
- `scan-torch`: scanner torch
- `scan-permission-action`: allow-camera/open-settings action

## Environment

Flows receive both values per run:

- `APP_ID`: `io.composery` for a native build, `host.exp.exponent` for Android
  Expo Go, or `host.exp.Exponent` for iOS Expo Go.
- `INSTANCE_URL`: a reachable server that returns the Composery marker.

The deterministic local fixture is:

```sh
node packages/mobile/scripts/test-instance.mjs
```

Use `http://10.0.2.2:4173` from the Android emulator,
`http://127.0.0.1:4173` from the iOS simulator, or the workstation LAN address
from a physical phone.

## Run

From `packages/mobile`, after the app is installed and the fixture is running:

```sh
maestro test \
  -e APP_ID=io.composery \
  -e INSTANCE_URL=http://10.0.2.2:4173 \
  src/maestro/e2e.yml
```

`e2e.yml` and `add-instance.yml` expect empty app storage. Use a fresh emulator
for repeatability. Do not clear a physical phone without its owner's permission.

Nightly CI generates and installs the native Release configuration on Android
and iOS, starts the fixture, and executes `e2e.yml`; it does not depend on Metro
or a development client.
