# WonderMoney Mobile

WonderMoney's mobile application is an Expo SDK 58 app using React Native
0.88 and React 19.

## Requirements

- Node.js 24 (`apps/mobile/.nvmrc`)
- pnpm: run `pnpm install` at the repository root, which installs every app

By default the app talks to the hosted API. Point it at a local or self-hosted one with
`EXPO_PUBLIC_API_BASE_URL` in `.env`, or with **Use a different server** on the sign-in
screen.

## Development

```bash
pnpm start
pnpm run ios       # native iOS development build
pnpm run android   # native Android development build
pnpm run web
```

The app talks to the backend through the HTTP API boundary. Keep the other
apps out of the mobile source tree: do not import source from `apps/api`
or `apps/web`, and use `packages/*` only through the dependency-free entry points of
`@wondermoney/shared` (such as `@wondermoney/shared/decimal`), never by relative path.

## Validation

The CI pipeline runs the test, lint, and type-check commands, plus its
Expo configuration/platform checks. Use those CI checks as the authoritative
validation path for changes.

## Releasing

Bump `version` in `app.config.ts`; EAS increments the build numbers itself
(`appVersionSource: remote`).

- **iOS:** `eas build -p ios --profile production`, then
  `eas submit -p ios --profile production --id <build id>`.
- **Android:** `eas build -p android --profile production`, then
  `eas submit -p android --profile production --id <build id>`. `app.config.ts`
  caps the Kotlin daemon's heap and the parallel C++ compiles so the release
  build fits in the memory of EAS's free Android builder. To build on your own
  machine instead, with JDK 17 and the Android SDK and NDK installed:

  ```bash
  eas build -p android --profile production --local --output wondermoney.aab
  eas submit -p android --profile production --path wondermoney.aab
  ```

  The local build signs with the credentials stored on EAS. Set
  `SENTRY_AUTH_TOKEN` so the source-map upload step succeeds.

`eas submit` reads the store keys from `secrets/`, which is gitignored.

### EAS configuration

The Expo account and the EAS project are not in the repository. `app.config.ts` reads them
from environment variables, with no defaults, so a fork sets its own:

| Variable | Read by | Value |
| --- | --- | --- |
| `WONDERMONEY_EXPO_OWNER` | `app.config.ts` (`owner`) | Expo account or organisation that owns the project |
| `WONDERMONEY_EAS_PROJECT_ID` | `app.config.ts` (`extra.eas.projectId`) | EAS project ID (`eas init` prints it) |
| `WONDERMONEY_GOOGLE_SERVICES_FILE` | `app.config.ts` (`android.googleServicesFile`) | Path to the Firebase project's `google-services.json`, for Android push (optional) |
| `WONDERMONEY_PASSKEY_DOMAINS` | `app.config.ts` (`ios.associatedDomains`, `extra.passkeyDomains`) | Hostnames whose passkeys the app may use, comma-separated (optional; see "Passkeys") |

Set them once as EAS environment variables (`eas env:create`, for `production`, `preview` and
`development`), so EAS Build workers resolve the same config. Locally, put them in
`apps/mobile/.env.local` (gitignored); `app.config.ts` loads that file itself, so both the Expo
CLI and EAS CLI see them without anything in your shell:

```sh
# apps/mobile/.env.local
WONDERMONEY_EXPO_OWNER=<expo account>
WONDERMONEY_EAS_PROJECT_ID=<eas project id>
```

Without them the app still runs locally (`pnpm start`); EAS commands need both.

Push notifications go through the Expo push service, which delivers with the push credentials
stored on the EAS project: an APNs key for iOS (`eas credentials -p ios`) and FCM V1 credentials
for Android (`eas credentials -p android`), plus `google-services.json` in the Android build
(`WONDERMONEY_GOOGLE_SERVICES_FILE`, for example as an EAS file environment variable). The
app's push tokens belong to this EAS project, so a server can push to them only while the
project accepts pushes without an access token, or with one it holds (`EXPO_ACCESS_TOKEN` on the
API and worker). The docs' self-hosting "Mobile app" page explains this for operators.

`eas submit` uses the App Store Connect API key stored on EAS (`eas credentials -p ios`, then
"App Store Connect: Manage your API Key", and set it up for submissions), so `eas.json` holds
no key path, key ID, issuer ID, app ID or team ID. An interactive `eas submit` finds the app by
its bundle identifier (`money.wonder.app`).

### Passkeys

"Sign in with a passkey" and the Security screen's passkeys use `react-native-passkeys` (an Expo
module: Apple's AuthenticationServices on iOS, Credential Manager on Android). A passkey belongs
to the web app's hostname (the server reports it as `features.passkeyRpId` in `/v1/instance`), and
the phone hands one to the app only when three things agree:

1. **The build lists the hostname**: `WONDERMONEY_PASSKEY_DOMAINS=money.example.com`. On iOS this
   adds the `webcredentials:money.example.com` entitlement, which needs the Associated Domains
   capability on the App ID in the Apple Developer account (EAS syncs capabilities on build).
   The app hides passkeys on a server whose hostname isn't in the list.
2. **The web app on that hostname vouches for the app**: it serves
   `/.well-known/apple-app-site-association` from `IOS_APP_TEAM_ID` and `IOS_APP_BUNDLE_ID`, and
   `/.well-known/assetlinks.json` from `ANDROID_APP_PACKAGE` and `ANDROID_APP_CERT_SHA256` (the
   SHA-256 fingerprints of the signing certificates: the upload key's and, with Play App Signing,
   Google's app signing key from the Play Console).
3. **The API accepts Android's origin**: `ANDROID_APP_CERT_SHA256` on the API too. Android reports a
   native app's assertion as `android:apk-key-hash:<certificate hash>`, not as the web origin.

Nothing account-specific is in the repository; until these are set, the app shows no passkey
option and the sign-in screen offers the other methods. The docs' self-hosting "Mobile app" page
has the operator's side.

## Important

This is no longer a disposable starter project. Do **not** run
`pnpm run reset-project`; the Expo scaffold script moves starter files and may
overwrite or hide application work. The script is retained only as legacy
scaffold residue and should be removed in a deliberate cleanup.
