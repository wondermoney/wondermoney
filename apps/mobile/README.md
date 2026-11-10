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
apps out of the mobile source tree: do not import source from `apps/api`,
`apps/web` or `packages/*`.

## Validation

The CI pipeline runs the test, lint, and type-check commands, plus its
Expo configuration/platform checks. Use those CI checks as the authoritative
validation path for changes.

## Releasing

Bump `version` in `app.config.ts`; EAS increments the build numbers itself
(`appVersionSource: remote`).

- **iOS:** `eas build -p ios --profile production`, then
  `eas submit -p ios --profile production --id <build id>`.
- **Android:** build locally. EAS's free Android builders run out of memory
  compiling the native modules, and the Gradle process is killed mid-build;
  the larger builder needs a paid Expo plan. With JDK 17 and the Android SDK
  and NDK installed:

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

`eas submit` uses the App Store Connect API key stored on EAS (`eas credentials -p ios`, then
"App Store Connect: Manage your API Key", and set it up for submissions), so `eas.json` holds
no key path, key ID, issuer ID, app ID or team ID. An interactive `eas submit` finds the app by
its bundle identifier (`money.wonder.app`).

## Important

This is no longer a disposable starter project. Do **not** run
`pnpm run reset-project`; the Expo scaffold script moves starter files and may
overwrite or hide application work. The script is retained only as legacy
scaffold residue and should be removed in a deliberate cleanup.
