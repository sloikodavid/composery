---
title: Google Play
description: Enroll, configure Play Console, use Play App Signing, complete Data Safety, and publish Android.
---

## 1. Account ownership and verification

Open [Play Console](https://play.google.com/console) and inspect the developer
account before creating another.

- Use a personal account only when the individual is the long-term publisher.
- Use an organization account for a registered business or organization. Google
  verifies legal identity, website, contact details, and normally D-U-N-S data.

Complete every item under **Developer account** -> **Account details** and
**Verification**. Add additional administrators, require two-step verification,
and use role-scoped users rather than sharing the owner login.

Personal accounts may be subject to a closed-testing gate before production.
Play Console shows the applicable requirement and progress; satisfy the console
requirement with real opted-in testers rather than documenting a fixed number or
duration that can drift.

Register `io.composery` in Google's Android developer-verification surfaces when
the account is prompted. Package ownership applies to Play and distribution
outside Play, including the GitHub APK.

## 2. Create or inspect the app

From **All apps**, search for package `io.composery`. Reuse it if present. To
create it choose **Create app**:

- App name: Composery.
- Default language: the maintained listing language.
- App or game: App.
- Free or paid: Free. This cannot be changed from free to paid later.
- Accept the required declarations after reading them.

Complete **Dashboard** -> **Set up your app**. The required sections include
store listing, app access, ads, content rating, target audience/content, news,
Data Safety, privacy policy, government/financial/health declarations when
applicable, and country availability. Answer from actual behavior and the
worksheet in [Review and privacy](review-and-privacy.md).

## 3. Play App Signing

The first Android store artifact is an AAB. In **Release** -> **Setup** ->
**App integrity**, enroll in Play App Signing and let Google generate the
app-signing key. EAS uses a separate upload key.

Before the first upload:

```sh
pnpm --filter mobile eas -- credentials --platform android
pnpm --filter mobile eas -- build --platform android --profile production
```

Download an encrypted upload-key backup from EAS. Add the submission service
account described below before submitting. EAS Submit can create the app's first
internal-track release; a manual first upload is not required. The release stays
in draft until the required Play setup is complete. If automation is unavailable,
upload the same AAB through **Testing** -> **Internal testing** -> **Create new
release** rather than producing another build.

After Play processes the bundle, copy the SHA-256 app-signing certificate digest
and upload certificate digest from **App integrity** into the release
password-manager record.

If Play offers automatic installer protection that requires installation from
Play, leave it disabled for Composery: the project intentionally distributes the
same Google-signed app through GitHub.

## 4. API access

Use a dedicated Google Cloud project for Play automation. In Play Console ->
**Users and permissions**, invite a dedicated service account and grant only the
app and release permissions needed for internal-track submission. Store its JSON
key through `eas credentials` for EAS Submit.

For GitHub to download Google-generated APKs, prefer GitHub OIDC plus Google
Workload Identity Federation over a long-lived JSON key:

1. Create a workload identity pool/provider trusting GitHub's OIDC issuer.
2. Restrict claims to the immutable repository identity, protected production
   environment, `main`, and the mobile release workflow.
3. Impersonate a dedicated service account with read-only Android Publisher
   access needed for generated APK download.
4. Store provider and service-account names as GitHub environment variables;
   they are identifiers, not credentials.

The EAS submission account and GitHub download account are separate principals
because they have different jobs.

## 5. Data Safety is a console form

Data Safety is not another public legal page. It is a structured declaration in
Play Console -> app -> **Policy and programs** -> **App content** -> **Data
Safety**. The public privacy policy supports and explains the answers.

The worksheet must account for native code, SDKs, WebView behavior, and the
publisher-operated Composery Cloud, not merely fields stored by React Native.
For this repository's configured feature set:

- No data is sold or shared for advertising.
- No advertising ID, location, contacts, microphone, media, files, health,
  financial, or cross-app tracking data is requested by the app.
- Instance URLs and labels stay on the device.
- QR camera frames are decoded on-device and are not retained or uploaded.
- Public Composery connections require HTTPS; cleartext is allowed only for a
  user-selected local-network host.
- A selected instance receives WebView requests and any data the user enters.
  A self-hosted operator is a different recipient/controller; Composery Cloud
  collection must match the website policy and the store declaration.

Re-run the worksheet whenever a dependency, permission, telemetry SDK, account
flow, or server behavior changes. Save the submitted export/screenshot and date
in the private release record; keep the non-secret rationale in Git.

## 6. Testing tracks and review access

Use one artifact through the track ladder:

1. **Internal testing:** every production build enters here first.
2. **Closed testing:** broader invited testing and any account production-access
   requirement.
3. **Open testing:** optional; not required for release quality.
4. **Production:** promote the tested release rather than rebuilding it.

Under **App content** -> **App access**, declare restricted access and provide
the permanent reviewer URL, reusable credentials, and instructions. The account
must not require an OTP, location, invitation acceptance, payment, or staff
intervention. Include the static QR value in the instructions.

Use **Publishing overview** -> **Managed publishing** when approved changes must
wait for a maintainer-controlled launch. Staged rollout is for production
updates; the first production release does not have a previous version to fall
back to.

## 7. GitHub APK

After the production AAB is accepted on the internal track, use the Android
Publisher generated APK API to download the universal APK produced and signed by
Google. Verify:

- Package is `io.composery`.
- Version name matches `mobile-vX.Y.Z`.
- Version code matches the submitted AAB.
- Signer SHA-256 matches Play Console's app-signing certificate.
- Active permissions match the native-config contract.
- The exact APK installs and passes the Android Maestro smoke test.

Publish that APK, its SHA-256 file, and a provenance JSON containing source
commit, EAS build ID, Play version code, package, and signer digest. Do not call
the AAB an installable download and do not publish an EAS preview APK as a stable
GitHub release.

## References

- [Choose a Play account type](https://support.google.com/googleplay/android-developer/answer/13634885)
- [Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756)
- [Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469)
- [App testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465)
- [EAS Submit for Google Play](https://docs.expo.dev/submit/android/)
- [Generated APK API](https://developers.google.com/android-publisher/api-ref/rest/v3/generatedapks/list)
- [Workload Identity Federation for pipelines](https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)
