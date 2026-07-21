---
title: Review and privacy
description: Maintain the reviewer instance, store declarations, legal pages, and submission evidence.
---

Store reviewers must be able to exercise the final binary without contacting a
maintainer. A review failure caused by inaccessible credentials is a release
failure, not an expected round trip.

## Permanent reviewer instance

Create one non-personal Composery instance dedicated to Apple, Google, and
release smoke tests. It must:

- Run the production Composery runtime on a stable HTTPS URL.
- Return the normal direct `/_composery` marker without redirects.
- Have a reusable reviewer password that never requires OTP, email approval,
  payment, VPN, IP allowlisting, or staff intervention.
- Contain only disposable sample files and no customer, maintainer, key, token,
  or production infrastructure data.
- Expose representative IDE functionality without destructive privileges over
  other systems.
- Be monitored for reachability and disk capacity.
- Be tested before every submission and after every runtime update.

Store the URL and credentials in the team password manager. Put only placeholders
and instructions in Git. Generate a static QR containing the add-instance deep
link or URL, verify it with the release binary, and attach the QR privately to
both review records.

## Reviewer walk-through

Track and paste a version of this template into each store:

```text
Composery Mobile is a native client for an existing Composery instance.

1. Start the app and choose Scan QR code, or choose Add instance.
2. Scan the attached QR / enter REVIEW_URL.
3. Keep the suggested label and choose Add.
4. Open the saved instance.
5. Sign in with REVIEW_CREDENTIALS if prompted.
6. Open the sample workspace and terminal.
7. Use the native back action to close an IDE layer, then return to the instance list.

Native functionality includes local instance management, QR scanning, camera
permission fallback, haptics, mobile navigation/back integration, system-theme
and safe-area handling, process recovery, and direct local/self-hosted access.
Top-level links outside the verified Composery origin open in the system browser.
No purchase is offered in the app.
```

Replace placeholders only in the private console fields. Test the exact pasted
instructions from a signed-out physical device.

## Store declaration worksheet

Review this table against the release commit and production services:

| Area                                  | Repository contract                                                                                                            | Recheck trigger                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Camera                                | The only runtime permission; QR decode on device; no image/video retained or uploaded                                          | Camera library or scan-flow change            |
| Microphone                            | Not requested                                                                                                                  | Camera/media dependency change                |
| Local storage                         | Instance URL, label, ID, last-used time                                                                                        | Instance-store schema change                  |
| Network                               | Direct selected-instance traffic; public HTTPS, local HTTP allowed                                                             | Probe, WebView, auth, or networking change    |
| WebView                               | Verified Composery origin/mount only; external top-level links leave app                                                       | Navigation or injection change                |
| Analytics/ads/tracking                | None                                                                                                                           | Any telemetry, attribution, ads, or crash SDK |
| Account                               | No native account creation; selected instance may authenticate                                                                 | Cloud/auth UI change                          |
| Purchases                             | None and no external purchase CTA                                                                                              | Pricing, subscription, or link change         |
| Notifications/location/contacts/files | None                                                                                                                           | New native feature/dependency                 |
| Deletion                              | Local instance can be removed; Cloud account deletion remains available through the hosted account UI and public support route | Account-flow change                           |

The merged Android APK also declares `INTERNET`, `ACCESS_NETWORK_STATE`, and
`VIBRATE`, plus AndroidX's package-scoped
`io.composery.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. These are install-time
capabilities with no user prompt. The package-scoped permission prevents other
apps from sending to protected receivers; it does not grant access to user
data. CI reads the built APK and fails if this exact set changes.

Apple App Privacy and Google Data Safety use different taxonomies. Complete each
console form separately, but reconcile both with this worksheet and the public
Privacy Policy. If the publisher-operated Cloud service receives data through
the embedded instance, include that processing where the store's WebView rules
require it. Do not declare “no data collected” merely because the native shell
has no analytics.

## Public legal pages

The Privacy Policy must continue to explain:

- Publisher/controller identity and contact route.
- On-device instance records and deletion.
- Camera purpose and on-device QR processing.
- Direct communication with user-selected instances.
- The distinction between Composery Cloud and independent self-hosted operators.
- SDK/provider processing, retention, user rights, and account deletion.

The Terms must distinguish the Apache-licensed app/runtime from the hosted Cloud
contract and explain that independent instances have their own operator. Both
pages must remain reachable without authentication and the app must expose easy
Privacy and Terms links.

## Evidence retained per submission

Keep a private release record containing:

- Store form exports/screenshots and submission timestamp.
- Reviewer URL, QR, and the password-manager item reference, not the password.
- Exact AAB/IPA/EAS build IDs and source commit.
- App-signing certificate digest and Android version code/iOS build number.
- Screenshots and listing copy submitted.
- Review correspondence and any policy interpretation.

Never commit credentials or private console screenshots.
