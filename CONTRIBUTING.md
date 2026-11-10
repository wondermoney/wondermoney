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
two small packages (see the [README](README.md)). You need Node 26, pnpm (`npm install -g
corepack && corepack enable`; Node 26 no longer bundles corepack) and Docker.

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

1. Fork the repository and create a branch from `develop`, the default branch. Open the
   pull request against `develop` too: `main` only receives promotions from `develop`.
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

## Leak check

CI's "Leak check" job keeps secrets and private details out of this public repository. It
runs [gitleaks](https://github.com/gitleaks/gitleaks) over your pull request's commits
(`.gitleaks.toml`), and greps the tree, the lines your commits add and their messages for the
patterns in `.github/leak-patterns.txt`: internal ticket ids, personal paths such as home
directories, IP addresses outside the loopback, private and documentation ranges, and the like.
A hit fails the "Type-check, lint, test and build" check and prints `file:line`. To run it
locally (gitleaks from your package manager):

```bash
gitleaks git . --config .gitleaks.toml --log-opts="origin/develop..HEAD"
.github/scripts/leak-check.sh origin/develop..HEAD
```

If it flags something real, remove it and rewrite the commit that added it (`git rebase -i`,
then force-push your branch): history is public too. If it is a false positive:

- **Example values:** use obviously fake ones, such as an RFC 5737 address (`192.0.2.1`,
  `198.51.100.1`, `203.0.113.1`) or a key like `test-key`, rather than allowlisting.
- **Otherwise:** say so in the pull request. The fix is a narrower pattern in
  `leak-patterns.txt`, an exact match in `.github/leak-allow.txt`, or an allowlist entry in
  `.gitleaks.toml` that names the exact value, never a whole file or rule.

## License

By contributing you agree that your contribution is licensed under this repository's
license (see [LICENSE](LICENSE): AGPL-3.0 for the apps, MIT for `packages/*`, CC BY 4.0
for the documentation text). You keep the copyright on your work.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
