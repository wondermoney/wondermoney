# WonderMoney Mobile

WonderMoney's mobile application is an Expo SDK 57 app using React Native
0.86 and React 19.

## Requirements

- Node.js 24 (the repository's `.nvmrc`)
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

## Important

This is no longer a disposable starter project. Do **not** run
`pnpm run reset-project`; the Expo scaffold script moves starter files and may
overwrite or hide application work. The script is retained only as legacy
scaffold residue and should be removed in a deliberate cleanup.
