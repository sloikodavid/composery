---
title: Releasing
description: Build preview APKs and publish versioned mobile releases without mixing image releases.
---

Container-image and mobile releases are independent products with independent
cadence. Image releases use `vX.Y.Z`; mobile releases use `mobile-vX.Y.Z`.
Neither is subordinate to the other. See `.github/IMAGE_RELEASE.md` and
`.github/MOBILE_RELEASE.md` for the short operator checklists.

## Preview APK

A preview is the fast path for maintainers, devices, demos, and build days:

```sh
pnpm --filter mobile check
pnpm --filter mobile eas -- whoami
pnpm --filter mobile eas -- project:info
pnpm --filter mobile eas -- build --platform android --profile preview
```

Download the APK from the successful EAS build page, record the EAS build ID,
and install it. Preview builds are not store submissions or public GitHub
releases. A later Play-signed APK may require uninstalling the preview because
its signing identity can differ.

## Prepare a production version

1. Choose the next semantic version.
2. Change `app.json.expo.version`. Keep package metadata aligned if the repo's
   version guard requires it.
3. Update changelog/store copy and screenshots when behavior changed.
4. Run `pnpm --filter mobile check`, `pnpm --filter mobile build`, and the native
   nightly workflow.
5. Test the reviewer instance and legal/store worksheet.
6. Merge the version PR to `main` with all checks green.

Do not create the tag before the release commit reaches `main`.

## Build and internal distribution

From the clean release commit:

```sh
pnpm --filter mobile eas -- build --platform all --profile production
pnpm --filter mobile eas -- submit --platform android --profile production
pnpm --filter mobile eas -- submit --platform ios --profile production
```

Android submission targets the internal track. iOS submission uploads to App
Store Connect/TestFlight. Neither command publishes to end users.

Record both EAS build IDs, Android version code, iOS build number, and source
commit. Install the Play-generated APK and TestFlight build; do not approve a
different rebuild.

## Approve the release

The release owner checks:

- Exact commit equals `origin/main`.
- Tag `mobile-vX.Y.Z` does not exist and X.Y.Z equals app version.
- Native-config, unit, export, and device checks passed.
- Reviewer instance and credentials work.
- Privacy, Data Safety, App Privacy, age/content rating, screenshots, and review
  notes match the binary.
- Store agreements, verification, certificates, and membership have no blocking
  warning.
- Another maintainer is available during launch/rollback where possible.

Create and push the signed/annotated `mobile-vX.Y.Z` tag. The mobile release
workflow verifies these invariants; the tag is the automation trigger, not an
escape from review.

## GitHub release contents

After Play accepts the AAB on the internal track, retrieve Google's generated
universal APK and test it. The GitHub release contains:

- `composery-X.Y.Z.apk`
- `composery-X.Y.Z.apk.sha256`
- `composery-X.Y.Z.provenance.json`
- Generated release notes linked to the mobile tag

The provenance record includes package ID, version name/code, commit, EAS build
ID, Play artifact identity, APK SHA-256, and signer-certificate SHA-256. GitHub
must not attest that its runner built an EAS artifact.

## Store launch

Promote the already-tested Play internal artifact through the chosen testing
track to production. In App Store Connect, select the tested build and submit
the completed version to App Review. Use managed/manual publishing for the first
release. For later updates, use a staged/phased rollout unless an urgent security
fix requires a different documented choice.

## Failure and rollback

- EAS build failure: fix source/config and create a new build number; never
  overwrite an accepted artifact.
- Internal test failure: stop promotion and leave GitHub release unpublished.
- Store rejection: preserve the artifact and correspondence; fix the cited
  behavior or metadata and resubmit.
- GitHub APK failure: remove the draft release asset, retrieve the correct
  Google-signed artifact, and re-run verification. Do not replace an immutable
  published tag with different source.
- Bad production update: halt the store rollout and restore availability with a
  new higher build number based on the last good source. EAS Update is disabled
  and is not a rollback channel.

## Credential rotation

Rotate one credential at a time. Verify a preview/internal build with the new
credential before revoking the old one. Record owner, purpose, creation,
recovery, and rotation procedure in the password manager, not in Git.
