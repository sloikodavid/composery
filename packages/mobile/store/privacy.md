# Store privacy worksheet

This is evidence, not a substitute for the public Privacy Policy or either
store's console questionnaire. Reconcile it with the release commit, generated
native config, production server behavior, and every bundled SDK.

## Native client facts

- Locally stored: instance URL, label, random local identifier, creation time,
  and last-used time.
- Publisher collection of that list: none.
- Camera: user-initiated QR decode on device; no retained/uploaded image, video,
  or audio.
- Permissions: camera is Android's only runtime permission. The merged APK also
  declares internet, network-state, vibration, and AndroidX's package-scoped
  receiver protection, none of which prompts the user. iOS has camera and
  local-network purpose strings. No microphone, storage, contacts, location,
  notification, advertising ID, or tracking permission.
- SDKs: no analytics, advertising, attribution, push, or third-party crash SDK.
- Network: direct traffic to the user-selected instance. Public hosts must use
  HTTPS; HTTP is accepted only for local-looking hosts.
- WebView: only a directly verified Composery origin and mount path can be the
  top-level document. External links use the system handler.
- Purchases: none; no pricing or external purchase CTA.
- Native account creation: none.

## Service behavior that still counts

Store forms can include data received by a publisher-operated Composery Cloud
instance through the controlled WebView. Review the website Privacy Policy and
production service before answering categories such as identifiers, contact
information, user content, diagnostics/security logs, and account deletion.
Traffic sent to an independently self-hosted instance goes to that operator, not
the Composery publisher, but each store's definition of collection/sharing must
be followed exactly.

## Release review

- [ ] `pnpm --filter mobile check:native-config` passes.
- [ ] Final APK/IPA permission and privacy-manifest inspection matches this file.
- [ ] Public Privacy Policy and Terms describe the submitted app.
- [ ] Apple App Privacy answers reconciled, exported/screenshot privately.
- [ ] Google Data Safety answers reconciled, exported/screenshot privately.
- [ ] App access/account deletion answers tested.
- [ ] No dependency or server change introduced telemetry or a new recipient.
- [ ] Submission evidence stored in the private release record.
