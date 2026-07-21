---
title: Apple and the App Store
description: Enroll, configure App Store Connect, test with TestFlight, and submit Composery Mobile.
---

Apple account state belongs to the Apple Developer website and App Store
Connect. Never create replacement identifiers or certificates before checking
those two systems and EAS credentials.

## 1. Enroll and assign ownership

Open [Apple Developer account](https://developer.apple.com/account) and inspect
**Membership details**. Enroll only if no appropriate team exists.

- Choose **Individual** when one legal person is the seller and long-term owner.
- Choose **Organization** when a registered legal entity should appear as seller
  and multiple people need durable access. Apple verifies the entity and its
  D-U-N-S record.

Enable two-factor authentication, add a recovery method, and add another person
with an administrative role when the team permits it. Keep membership renewal
active; expiration removes distribution and can disrupt TestFlight.

In App Store Connect -> **Users and Access**, give maintainers the smallest role
that covers their work. Restrict API keys to app-management responsibilities;
do not share an Account Holder login.

## 2. Register the identifier

Open Apple Developer -> **Certificates, Identifiers & Profiles** ->
**Identifiers**.

1. Search for `io.composery`.
2. If it exists on the intended team, inspect and reuse it.
3. Otherwise choose **+** -> **App IDs** -> **App**, use description
   `Composery`, choose explicit bundle ID `io.composery`, and enable only the
   capabilities the app uses.

The app needs no push, associated-domain, Sign in with Apple, keychain-sharing,
background, health, location, or iCloud capability. Do not enable capabilities
pre-emptively.

## 3. Create or inspect the App Store record

Open App Store Connect -> **Apps**, search by bundle ID, and reuse an existing
record. To create one choose **+** -> **New App**:

- Platforms: iOS.
- Name: Composery, subject to store-name availability.
- Primary language: the maintained listing language.
- Bundle ID: `io.composery`.
- SKU: a stable internal value such as `composery-ios`.
- User access: restrict only if the team intentionally separates app access.

Record the numeric Apple app ID shown in **App Information**. Put it in
`eas.json` as the production submit profile's `ascAppId`; it is configuration,
not a secret.

## 4. Signing and submission access

From the repository root, inspect EAS before creating anything:

```sh
pnpm --filter mobile eas -- credentials --platform ios
```

Let EAS create or reuse the distribution certificate and provisioning profile.
Download an encrypted backup through the credential manager and record which
Apple team owns it.

For non-interactive submission, App Store Connect -> **Users and Access** ->
**Integrations** -> **App Store Connect API**:

1. Request/enable API access if the account has not done so.
2. Create a key limited to the role EAS Submit needs.
3. Download the `.p8` once and record issuer ID and key ID.
4. Upload it through `eas credentials`; do not put it in GitHub or EAS
   environment variables.

## 5. Listing contents

App Store Connect -> app -> **App Information** and the version page must have:

| Field                | Composery source                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Name/subtitle        | Tracked store copy under `packages/mobile/store/`                                          |
| Description/keywords | Tracked store copy; describe an existing-instance client, not purchasing                   |
| Support URL          | A public support page or repository issue path                                             |
| Marketing URL        | Optional; never use it as an in-app purchase CTA                                           |
| Privacy policy URL   | `https://www.composery.io/privacy`                                                         |
| Category             | Developer Tools, with a defensible secondary category only                                 |
| Copyright            | Legal owner and year maintained in App Store Connect                                       |
| Age rating           | Answer from observable app/instance behavior, including unrestricted web content questions |
| Screenshots          | Real release build on required device sizes; no debug UI or personal data                  |

Complete App Privacy from the worksheet in
[Review and privacy](review-and-privacy.md). Apple treats data collected through
a controlled WebView as app data; do not answer solely from React Native code.

If distributing in the EU, App Store Connect -> **Business** / **Compliance** ->
**Digital Services Act** requires a trader declaration and verified public
contact details. Assess the legal status with the owner; do not guess in code.

## 6. TestFlight

Build and submit the exact production configuration:

```sh
pnpm --filter mobile eas -- build --platform ios --profile production
pnpm --filter mobile eas -- submit --platform ios --profile production
```

Submission uploads to App Store Connect; it does not submit the version for App
Review. In App Store Connect -> app -> **TestFlight**:

1. Wait for processing and answer export-compliance prompts. The app config
   declares use of exempt standard encryption.
2. Add internal testers and complete the reviewer-instance flow.
3. Add an external testing group only when external beta distribution is useful;
   provide beta review notes and credentials.
4. Test camera denial, local HTTP, external links, login, keyboard, rotation,
   background/foreground, and instance removal on a physical iPhone/iPad as
   applicable.

## 7. App Review

On the version page select the tested build, complete every metadata warning,
and fill **App Review Information** from the tracked review template:

- Contact person with monitored email and phone.
- Sign-in required: yes when the review instance requires it.
- Reusable username/password or box password; never an OTP or personal account.
- Notes describing native instance storage, QR scanning, direct self-hosted
  connections, haptics/navigation, local-network use, and why external links
  leave the WebView.
- A stable URL and static QR that reach the same review instance.

Use manual release for the first approved version. For later versions, choose
manual or phased release deliberately rather than allowing an approval to
publish while maintainers are unavailable.

## Rejection handling

Keep the submitted binary and correspondence. Respond to the exact guideline
with reproducible review steps. A minimum-functionality/thin-client rejection
requires demonstrating or adding native product value; changing CI or wording
alone is not a fix. Never submit repeated near-identical binaries without
addressing the cited behavior.

## References

- [Apple Developer enrollment](https://developer.apple.com/programs/enroll/)
- [Create an App Store Connect record](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/)
- [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [App privacy details](https://developer.apple.com/app-store/app-privacy-details/)
