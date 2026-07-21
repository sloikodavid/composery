---
title: Mobile
description: Architecture, ownership, and runbooks for packages/mobile.
---

`packages/mobile` is the Expo Router client for Composery instances. It stores
instance URLs on the device, proves each endpoint is Composery, and displays the
verified instance in a native WebView shell. Top-level navigation outside that
instance opens through the operating system rather than inside the WebView.

The mobile release path has four distinct systems:

1. GitHub owns source, checks, version tags, and public release records.
2. Expo Application Services (EAS) builds and signs native binaries.
3. App Store Connect owns TestFlight, App Review, and iOS distribution.
4. Play Console owns Android testing tracks, review, Play App Signing, and
   production distribution.

No one console is the source of truth for the whole release. The repository
records every reproducible value and the runbooks record how to inspect the
account-owned state that cannot live in Git.

## Start by discovering state

Do this before creating, linking, or rotating anything:

```sh
pnpm --filter mobile eas -- whoami
pnpm --filter mobile eas -- project:info
pnpm --filter mobile eas -- build:list --limit 5
```

Then inspect:

- Expo dashboard -> project -> **Configuration** and **Credentials**.
- App Store Connect -> **Apps** for bundle ID `io.composery`.
- Play Console -> **All apps** for package `io.composery`.
- GitHub -> **Settings** -> **Environments** for `mobile-preview` and
  `mobile-production`.

If an object already exists, maintain it. Do not create a second project, app
record, package, signing key, or service account to make a command pass.

## Permanent and replaceable identity

| Value                                     | Owner                    | Change rule                                                 |
| ----------------------------------------- | ------------------------ | ----------------------------------------------------------- |
| `io.composery`                            | `app.json` + both stores | Final after first store upload                              |
| EAS project ID                            | Expo                     | Transferable between Expo accounts; never recreate casually |
| Android app-signing key                   | Google Play              | Irreplaceable identity; Google should hold it               |
| Android upload key                        | EAS credentials          | Rotatable through Play Console                              |
| Apple distribution certificate            | Apple/EAS                | Rotatable                                                   |
| Apple provisioning profile                | Apple/EAS                | Regenerated as needed                                       |
| `mobile-vX.Y.Z`                           | GitHub                   | Immutable public mobile release tag                         |
| app `version`                             | `app.json`               | Must match the mobile release tag                           |
| Android `versionCode` / iOS `buildNumber` | EAS remote versions      | Monotonic build identity                                    |

The `owner` in `app.json` names the Expo account that owns the EAS project. A
personal account is supported. Moving to an Expo Organization is an ownership
and access-control improvement, not a prerequisite; use Expo's project-transfer
flow so the project ID and credentials stay intact.

## Release types

- **Development:** Expo Go and local unit/native-config checks. No store or
  signing credentials.
- **Preview:** an EAS internal-distribution APK for maintainers and event/device
  testing. It is not a public release and may use a different signing identity
  from the later Play-signed APK.
- **Production build:** EAS `.aab` and `.ipa` artifacts submitted to Play's
  internal track and TestFlight.
- **Public mobile release:** stores promote the tested production artifacts;
  GitHub publishes `mobile-vX.Y.Z` and the Google-signed universal APK.

Read the runbooks in order for first setup. For normal work, use
[Development](development.md) and [Releasing](releasing.md).

## Security and privacy contract

- Camera permission is requested only from the scanner screen and manual URL
  entry remains available after denial.
- Camera is Android's only runtime permission. The merged APK also declares
  internet, network-state, vibration, and a package-scoped AndroidX receiver
  permission; none of those four prompts the user or grants access to user data.
- The app does not request microphone, storage, contacts, location, advertising
  ID, notification, or tracking permission.
- The app contains no analytics, advertising, push, or third-party crash SDK.
- The local instance list is not sent to Composery.
- A direct, non-redirecting `/_composery` marker must succeed before a URL can
  become the WebView's main document.
- The verified origin and mount path are the only allowed top-level WebView
  scope. External links use the system handler.
- EAS Update is disabled. Shipping new JavaScript requires a new reviewed
  binary until the update threat model and store policy are deliberately added.

`pnpm --filter mobile check:native-config` asserts the generated Android
manifest and iOS plist so dependencies cannot silently weaken this contract.

## References

- [Expo accounts](https://docs.expo.dev/accounts/account-types/)
- [EAS monorepos](https://docs.expo.dev/build-reference/build-with-monorepos/)
- [EAS managed credentials](https://docs.expo.dev/app-signing/managed-credentials/)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play policy center](https://play.google.com/about/developer-content-policy/)
