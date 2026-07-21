# Mobile release

Mobile releases are independent from container-image releases. The full setup,
store, review, privacy, and recovery runbooks are under
[`docs/developing/mobile/`](../docs/developing/mobile/index.md).

## Preview APK

For a device/demo build, run **Actions** -> **mobile-preview** -> **Run
workflow**, or run the EAS preview command from the mobile development guide.
After GitHub environment `mobile-preview` has `EXPO_TOKEN`, setting repository
variable `MOBILE_PREVIEW_ENABLED=true` also builds a preview APK whenever mobile
code reaches `main`.

Preview APKs are test artifacts, not public releases.

## Production mobile release

1. Complete the Apple, Google Play, Expo, reviewer-instance, and GitHub
   environment setup in the mobile docs.
2. Merge a PR setting `packages/mobile/app.json` version to `X.Y.Z`, with listing
   copy/privacy answers reviewed and all checks green.
3. Verify the exact `main` commit and create annotated tag `mobile-vX.Y.Z`.
4. Push the tag.

The tag automatically starts `mobile-release`: it builds and submits the AAB/IPA
to Play internal testing and TestFlight, waits for Play's Google-signed universal
APK, verifies and installs that APK, runs Maestro, then publishes the GitHub
Release assets.

Store production publication remains a deliberate console approval after human
testing of those exact artifacts. Do not rebuild between internal testing and
production promotion. Do not create `mobile-v*` releases manually.
