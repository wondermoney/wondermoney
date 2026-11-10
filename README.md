# WonderMoney

Free, open-source personal finance you can run yourself. Accounts and transactions, bank
sync, budgets, goals, loans, households and investment portfolios, on the web and on iOS
and Android.

- **Use it:** the hosted instance at [wonder.money](https://wonder.money) is free.
- **Run your own:** one Docker Compose file with Postgres, the API, its worker and the web
  app. See [apps/api/deploy/selfhost](apps/api/deploy/selfhost/README.md). The mobile app
  connects to any server from its sign-in screen.
- **Hack on it:** read on, then [CONTRIBUTING.md](CONTRIBUTING.md).
- **Help keep it running:** the hosted instance's servers, AI and market data cost money.
  [Sponsor the project on GitHub](https://github.com/sponsors/wondermoney) if you'd like to chip in.

## What's in here

| Path | What | Stack |
|---|---|---|
| [`apps/api`](apps/api) | REST API and background worker | Express 5, MikroORM 7, PostgreSQL, pg-boss, better-auth |
| [`apps/web`](apps/web) | Web app | Next.js 16, React 19, Tailwind 4 |
| [`apps/mobile`](apps/mobile) | iOS and Android app | Expo SDK 58, React Native 0.88 |
| [`apps/docs`](apps/docs) | User documentation ([docs.wonder.money](https://docs.wonder.money)) | Next.js 16, Fumadocs |
| [`packages/shared`](packages/shared) | Market-data client and CSV parsers used by the API | TypeScript |
| [`packages/react-email`](packages/react-email) | Email templates used by the API | React Email |

Optional integrations (AI, market data, file storage, email, error tracking) switch on
when configured and are hidden when not; the core app needs only Postgres.

## Develop

Requirements: Node 26 LTS (`.nvmrc`; the Expo tooling in `apps/mobile` stays on Node 24, see
its `.nvmrc`), pnpm via [corepack](https://github.com/nodejs/corepack)
(`npm install -g corepack && corepack enable`; Node 25+ no longer bundles it), and Docker for
the local database.

```bash
pnpm install
pnpm build:lib                                 # the two workspace packages the API uses
pnpm --filter @wondermoney/api bootstrap         # local .env, Postgres in Docker, migrations, seed data
pnpm dev:api                                   # http://localhost:3001
pnpm dev:web                                   # http://localhost:3000
```

`pnpm dev:worker`, `pnpm dev:mobile` and `pnpm dev:docs` start the rest. Each app's README
has the details.

Checks, across every package (Turborepo runs only what changed):

```bash
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

## License

[AGPL-3.0](LICENSE) for the apps; MIT for `packages/*`; CC BY 4.0 for the documentation
text in `apps/docs/content`. Running a modified version as a service for others means
offering them its source.
