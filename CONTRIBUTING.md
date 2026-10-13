# Contributing to WonderMoney

Thanks for helping. WonderMoney is a free, open-source, self-hostable personal finance
app, and contributions of every size are welcome: bug reports, fixes, translations,
documentation and features.

## Before you start

- **Bugs:** open an issue with steps to reproduce, what you expected and what happened.
  Never include real financial data, credentials or tokens.
- **Features:** open an issue to discuss it first, so nobody spends a weekend on
  something that does not fit.
- **Security issues:** do not open an issue; follow [SECURITY.md](SECURITY.md).

## Getting set up

This is one repository for everything: the API, the web and mobile apps, the docs site and
two small packages (see the [README](README.md)). You need Node 24, pnpm (`corepack
enable`) and Docker.

```bash
pnpm install
pnpm build:lib                          # the workspace packages the API imports
pnpm --filter @wondermoney/api bootstrap  # local .env, Postgres in Docker, migrations, seed data
pnpm dev:api                            # then pnpm dev:web, dev:mobile or dev:docs
```

Before opening a pull request, run the checks. Turborepo only re-runs what your change
touches:

```bash
pnpm type-check && pnpm lint && pnpm test
```

Each app's README covers its own details. For the API in particular: migrations change the
schema only (data goes in seeders), and `.env` must point at a local database.

## Making a change

1. Fork the repository and create a branch from `main`.
2. Keep the change focused: one fix or feature per pull request.
3. Add or update tests for behaviour you change. A good test fails for a reason a user
   would care about; it asserts outcomes, not implementation details.
4. Make sure the checks pass locally (see above); CI runs the same ones.
5. Use a [Conventional Commits](https://www.conventionalcommits.org) subject, such as
   `fix(budget): keep rollover when a category is renamed`.
6. Open a pull request describing what changed and why, with screenshots for UI changes.

User-facing text goes through the translation files (English, Portuguese and Spanish);
please don't hardcode strings. If you can't translate, add the English text and say so
in the pull request.

## License

By contributing you agree that your contribution is licensed under this repository's
license (see [LICENSE](LICENSE): AGPL-3.0 for the apps, MIT for `packages/*`, CC BY 4.0
for the documentation text). You keep the copyright on your work.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
