---
title: Expo and EAS
description: Own the EAS project, environments, builds, versions, and signing credentials.
---

## Inspect before setup

```sh
pnpm --filter mobile eas -- whoami
pnpm --filter mobile eas -- project:info
pnpm --filter mobile eas -- build:list --limit 5
```

`app.json` contains the expected owner and EAS project ID. If `project:info`
resolves that project, it is already linked: do not run `eas init` and create a
replacement.

If it is not linked, sign into the intended owner from the repository root:

```sh
pnpm --filter mobile eas -- login
pnpm --filter mobile eas -- init
```

Review and commit only the project ID/owner change. Never commit a token or
credential file.

## Personal account or Organization

Both work. A personal owner is simplest for a single maintainer. An Expo
Organization provides multiple owners, role-scoped robot users, and continuity
when a maintainer leaves.

To move an established project, create the Organization in the Expo dashboard,
invite and verify another owner, then use the project's transfer action. After
transfer, update `app.json.owner`, run `eas project:info`, list credentials, and
make one preview build. Do not initialize a new project or regenerate signing
credentials as part of a transfer.

## Environments

Open Expo dashboard -> project -> **Environment variables** and maintain three
named environments:

- `development`: local/dev-only public configuration.
- `preview`: internal-distribution configuration.
- `production`: store configuration.

The application has no required secrets at build time. If one is introduced,
document it in `docs/configuration.md`, add it to the applicable EAS environments,
and prove the built artifact reads it. GitHub environment variables do not
automatically reach EAS workers.

Do not put server passwords, session tokens, Apple keys, or Google JSON keys in
Expo environment variables. Signing and submission credentials have dedicated
EAS credential stores.

## Profiles and versions

`eas.json` defines:

- `preview`: internal Android APK, automatically incremented build identity.
- `production`: Android AAB and iOS IPA, automatically incremented build
  identity.
- `submit.production`: Android internal track; iOS uploads to App Store Connect.

`app.json.expo.version` is the marketing version and must match the mobile tag.
EAS remote versions own Android `versionCode` and iOS `buildNumber`. Inspect or
change them with:

```sh
pnpm --filter mobile eas -- build:version:get --platform android
pnpm --filter mobile eas -- build:version:get --platform ios
pnpm --filter mobile eas -- build:version:set --platform android
pnpm --filter mobile eas -- build:version:set --platform ios
```

Never reset a remote build number below a number accepted by a store.

## Build credentials

From the repository root:

```sh
pnpm --filter mobile eas -- credentials --platform android
pnpm --filter mobile eas -- credentials --platform ios
```

Android production uses an upload key in EAS; Google Play holds the app-signing
key. Download an encrypted backup of the upload keystore and record its alias and
password in the project password manager. If lost, request an upload-key reset
in Play Console; do not replace the Play app.

For Apple, EAS may create and manage the distribution certificate and profile.
Keep account recovery and at least one additional team owner outside EAS. A
certificate can be rotated; do not revoke a working certificate merely because
another one exists.

## Programmatic GitHub access

For `mobile-preview`, a personal Expo access token is accepted. For a team,
create an Expo robot user with only the project role needed to build. Store the
token as `EXPO_TOKEN` in GitHub environment `mobile-preview` and separately in
`mobile-production`; environment approval protects the production copy.

Test the token without printing it:

```sh
EXPO_TOKEN=<from-password-manager> pnpm --filter mobile eas -- whoami
```

Rotate by adding and testing the new token, updating both GitHub environments,
then revoking the old token. Never paste it into an issue, workflow input, log,
or `.env` committed to Git.

## EAS Update

Updates are intentionally disabled in `app.json`. Do not run `eas update` and
assume users receive it. Introducing OTA updates is a separate feature requiring
runtime-version policy, preview/production channels, staged rollout, rollback,
code-signing decisions, privacy review, and a documented boundary prohibiting
feature changes that require store review.

## References

- [Account types and Organizations](https://docs.expo.dev/accounts/account-types/)
- [Programmatic access](https://docs.expo.dev/accounts/programmatic-access/)
- [EAS environment variables](https://docs.expo.dev/eas/environment-variables/)
- [Managed credentials](https://docs.expo.dev/app-signing/managed-credentials/)
- [App versions](https://docs.expo.dev/build-reference/app-versions/)
