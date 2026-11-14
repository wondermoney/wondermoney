# WonderMoney mobile

Expo SDK 58, React Native 0.88, React 19.3.0 (pinned workspace-wide; move it only together with
the Expo SDK, see the root `CLAUDE.md`). Node 24 (`apps/mobile/.nvmrc`; the rest of the repo is on 26) and pnpm from the repository
root; there is no app-local lockfile. Scripts are in `package.json`.

## Boundaries

- The app talks to the API over HTTP only. Never import source from `apps/api` or `apps/web`;
  follow the API's HTTP contract (`src/lib/api/` holds the endpoint schemas). `packages/*` are
  used only through a dependency-free workspace entry point, never by relative path: today
  `@wondermoney/shared/decimal`, which reads typed numbers (`src/lib/formatters/decimal-input.ts`).
- Auth is the API's better-auth, at `<EXPO_PUBLIC_API_BASE_URL>/api/auth`. The base URL comes
  from `.env` (`EXPO_PUBLIC_API_BASE_URL`) or the sign-in screen's "Use a different server".
  `EXPO_PUBLIC_*` values ship in the client; no secret goes in them.
- Telemetry is bound by `docs/telemetry-adr.md` (PostHog event and property allowlist) and
  `docs/telemetry-adr-sentry.md` (Sentry). Change those boundaries only together with the ADR.
- Visual rules are in `DESIGN.md`; `DESIGN_HISTORY.md` holds the accepted-debt log and the
  cross-platform gaps code comments cite.
- Copy lives in `src/lib/i18n/resources/` (en, es, pt-PT). pt-PT addresses the reader as
  **tu** ("Toca para atualizar", "a tua conta"), never "você" or the formal third person;
  labels stay infinitive. `CONTRIBUTING.md` has the rule and examples, and
  `src/lib/i18n/pt-form-of-address.test.ts` enforces it.

## Expo

Read the versioned docs at https://docs.expo.dev/versions/v58.0.0/ before changing Expo or
React Native behaviour, and keep Expo packages SDK 58-compatible.

The Expo owner and the EAS project ID come from environment variables
(`WONDERMONEY_EXPO_OWNER`, `WONDERMONEY_EAS_PROJECT_ID`), loaded locally from the gitignored
`.env.local`; the App Store Connect API key lives on EAS. README.md, "EAS configuration",
explains both. Never write those values, the App Store Connect app ID or the Apple team ID into
`app.config.ts` or `eas.json`, and give them no defaults.

## Checks

Before handing off, run `pnpm verify:changed` from the repository root: it runs the related Jest
tests, `type-check` and ESLint on Node 24 (the root `CLAUDE.md`, "Verifying a change"). CI also runs
`pnpm exec expo install --check` and Expo Doctor; run them when you change dependencies.

`pnpm reset-project` is Expo scaffold residue that moves application files. It is not setup;
leave it alone.
