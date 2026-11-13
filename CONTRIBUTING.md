# Contributing to WonderMoney

Thanks for helping. WonderMoney is a free, open-source, self-hostable personal finance
app, and contributions of every size are welcome: bug reports, fixes, translations,
documentation and features.

## Before you start

- **Questions:** ask in [Discussions](https://github.com/wondermoney/wondermoney/discussions),
  which is also the place for open-ended ideas. The [documentation](https://docs.wonder.money)
  covers using WonderMoney and [running your own instance](https://docs.wonder.money/en/docs/self-hosting).
- **Bugs:** [open an issue](https://github.com/wondermoney/wondermoney/issues/new/choose)
  with steps to reproduce, what you expected and what happened. Never include real
  financial data, credentials or tokens.
- **Features:** open an issue to discuss it first, so nobody spends a weekend on
  something that does not fit.
- **Security issues:** do not open an issue; follow [SECURITY.md](SECURITY.md) and report
  it privately.

## Finding something to work on

- Issues labelled [`good first issue`](https://github.com/wondermoney/wondermoney/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22)
  are small and self-contained, a good way to learn the codebase.
- Issues labelled [`help wanted`](https://github.com/wondermoney/wondermoney/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22help%20wanted%22)
  are well defined and ready for anyone to pick up.
- Issues labelled [`ready-for-agent`](https://github.com/wondermoney/wondermoney/issues?q=is%3Aissue%20is%3Aopen%20label%3Aready-for-agent)
  are fully specified, so you can start straight away, by hand or with AI help (see
  [Using AI](#using-ai)). Issues labelled [`ready-for-human`](https://github.com/wondermoney/wondermoney/issues?q=is%3Aissue%20is%3Aopen%20label%3Aready-for-human)
  need a person's judgment, such as a product decision or a third-party account.
- To claim an issue, comment on it before you start, so two people don't do the same work,
  and ask there if anything is unclear. If an issue has gone quiet after someone claimed it,
  feel free to ask whether it is still being worked on.

## Before large or core changes

Some areas hold everyone's data: accounts, transactions, budgets, bank sync, households,
auth and database migrations. A change there needs an issue with an agreed approach before
you write code. Open the issue, or comment on an existing one, and wait for a maintainer to
agree. This saves you a rewrite.

Small fixes, documentation and translations don't need this. Open the pull request directly.

## Getting set up

This is one repository for everything: the API, the web and mobile apps, the docs and
marketing sites and two small packages (see the [README](README.md)). You need Node 26, pnpm
(`npm install -g corepack && corepack enable`; Node 26 no longer bundles corepack) and Docker.

```bash
pnpm install
pnpm build:lib                          # the workspace packages the API imports
pnpm --filter @wondermoney/api bootstrap  # local .env, Postgres in Docker, migrations, seed data
pnpm dev:api                            # then pnpm dev:web, dev:mobile, dev:docs or dev:landing
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
   pull request against `develop` too: `main` only receives release pull requests from `develop`.
2. Keep the change focused: one fix or feature per pull request.
3. Add or update tests for behaviour you change. A good test fails for a reason a user
   would care about; it asserts outcomes, not implementation details.
4. Make sure the checks pass locally (see above); CI runs the same ones.
5. Use a [Conventional Commits](https://www.conventionalcommits.org) subject, such as
   `fix(budget): keep rollover when a category is renamed`.
6. Open a pull request describing what changed and why, with screenshots for UI changes.
   The [pull request template](.github/pull_request_template.md) lists what to include.

If `develop` moves on while you work, rebase your branch onto it and force-push:
`git fetch upstream && git rebase upstream/develop`, where `upstream` is this repository.

User-facing text goes through the translation files (English, Portuguese and Spanish);
please don't hardcode strings. Every key must exist in all three locales with the same
ICU placeholders (`{name}`, plural and select arguments), and every documentation page
and `meta.json` entry must exist in `en`, `pt` and `es`. CI enforces this: the web and
mobile i18n tests, the transactional-email copy check and the docs locale-parity check
fail with the locale, file and key to fix. If you can't translate, add the English text
to all three locales and say so in the pull request.

Portuguese copy is European Portuguese (pt-PT) and addresses the reader as **tu**, in the
web app, the mobile app, emails, the docs and the marketing site. Write the verb in the
second person singular, the possessive as teu/tua and the pronoun as te/ti/contigo; never
"você" or the formal third person:

| Not this | This |
|---|---|
| Introduza o seu email | Introduz o teu email |
| Tem a certeza de que pretende eliminar esta conta? | Tens a certeza de que queres eliminar esta conta? |
| Clique em Guardar para continuar | Clica em Guardar para continuar |
| Não feche esta janela | Não feches esta janela |
| Enviamos-lhe uma ligação | Enviamos-te uma ligação |

Buttons and menu items stay in the infinitive ("Guardar", "Adicionar conta"), and "seu/sua"
is still right for someone else's things ("{name} convidou-te para o seu agregado"), as is
"vocês" for more than one person. The
legal pages (terms, privacy, cookies) keep their formal "o utilizador" register, and
Brazilian Portuguese, if it is ever added, uses "você". The web, mobile and email checks
fail on "você" and on formal imperatives such as "Clique" or "Introduza" in pt copy.

## Shipping a feature behind preview features

A feature that is not ready for everyone can ship behind the per-user preview toggle
instead of living on a long branch. The API route returns 404 for users without the flag,
and the web and mobile entry points are hidden for them. Anyone can turn it on in
Settings to try it. [docs/preview-features.md](docs/preview-features.md) covers the
preference store, the API middleware, the client hooks and the tests.

## Using AI

You may use AI tools. We review your contribution, not the tool, and you own it:

- You chose the approach and understand it.
- You ran the change and the checks yourself.
- It stays within the issue's scope.
- You can answer review questions about it.

The same goes for issues. Describe what you did and what you saw. Don't paste a model's scan
of the code, or findings you haven't checked yourself.

A pull request or issue that doesn't meet this may be closed without a detailed review.
You're welcome to reopen it once it does.

## Money, tenancy and auth

A bug here can get someone's money wrong or show it to the wrong person, so the bar is higher.

- **Write the failing test first**, then the fix. This covers amounts and balances, household
  scoping, account privacy and sign-in.
- **Use the existing amount helpers.** In the API, money arithmetic goes through
  [`apps/api/src/utils/money.ts`](apps/api/src/utils/money.ts); typed or imported amounts are
  read with `@wondermoney/shared/decimal`. Don't add or round amounts as plain numbers.
- **Scope every query to the household.** ORM queries get the household filter
  automatically. Raw SQL, Kysely and query-builder queries skip it, so they need explicit
  household and account-privacy conditions. Add a test that another household's data stays out.

## Releasing (maintainers)

1. Use the open pull request titled "Release: develop → main". A workflow
   (`.github/workflows/release-pr.yml`) opens it on a push to `develop` and keeps its list of
   changes current; if there is none, open one from `develop` into `main`.
2. Its required check comes from CI's run on `develop`'s head commit. If it is missing, run CI
   on `develop` again (Actions, CI, Run workflow).
3. Merge it with a merge commit; squash and rebase merges are blocked on `main`. Merging
   deploys production.
4. Optionally, tag the release to publish the self-hosting images and notes:
   `gh release create vX.Y.Z --target main --generate-notes`. The tag also runs
   `.github/workflows/publish-images.yml`, which builds the images and attaches `install.sh` and
   its SHA-256 checksum to the release: that is what the one-line install in
   `apps/api/deploy/selfhost/README.md` downloads. It also publishes the Helm chart, with the
   release's version, to `oci://ghcr.io/wondermoney/charts/wondermoney`. To edit the notes
   before anyone sees them, create the release as a draft instead (see
   [Release notes](#release-notes)).
5. Once that workflow has published the images, bump the Render Blueprint in a pull request
   against `develop` (the one that adds the "What's new" page will do): set the three image tags
   in [`render.yaml`](render.yaml) (`wondermoney-api`, `wondermoney-worker`, `wondermoney-web`)
   to the new version, without the `v`. Not before: a Render instance whose Blueprint has Auto Sync
   on can pick up the new tag as soon as it reaches `develop`, which the "Deploy to Render" button
   deploys from. CI's "API extras" job warns on every run while the tag is behind the latest
   release, and fails if it names no release. The same check fails a pull request that makes a
   setting required without adding it to `render.yaml`
   (`pnpm --filter @wondermoney/api render:check`).

## Release notes

Each tagged release has notes on GitHub and a "What's new" page on the docs site. Whoever
writes them follows these steps.

1. **Label pull requests as they merge.** [`.github/release.yml`](.github/release.yml) groups
   GitHub's generated notes by label, and a pull request goes into the first section that
   matches one of its labels:

   | Label | Section |
   |---|---|
   | `security`, `privacy` | Security and privacy |
   | `self-hosting` | Self-hosting |
   | `translations` | Translations |
   | `enhancement` | Features |
   | `bug` | Fixes |
   | `documentation` | Documentation |
   | `dependencies` (Dependabot adds it) | Dependencies |
   | any other, or none | Other changes |

   The title's Conventional Commits type is a guide: `feat` is `enhancement`, `fix` is `bug`.
   Area labels such as `api`, `web` and `mobile` pick no section. A pull request labelled
   `skip-release-notes` is left out, and so is the "Release: develop → main" pull request.
2. **Generate a draft** once the release pull request is merged:
   `gh release create vX.Y.Z --target main --generate-notes --notes-start-tag vA.B.C --draft`,
   where `vA.B.C` is the previous release. A draft creates no tag yet, so nothing is published.
3. **Edit the draft** for the people who run and use WonderMoney. Start with an
   **Upgrading** section: migrations (and whether to back up first), new or changed
   settings, and commands to run after updating, or "Nothing to do" when there are none.
   Then rewrite the grouped lists in plain terms, referencing issues or pull requests, and
   drop entries nobody outside the project would notice.
4. **Credit contributors.** GitHub's "New Contributors" list names only first-time
   contributors, and rewriting the lists drops the "by @author" on each line. Print a
   "Thanks to" section that names every pull request author, with first-time contributors
   marked, and paste it at the end of the notes:

   ```bash
   .github/scripts/release-thanks.sh vX.Y.Z vA.B.C
   ```

   It reads the same generated notes, so it credits exactly the pull requests in the draft.
5. **Publish the draft.** That creates the tag, which runs `publish-images.yml` (see
   [Releasing](#releasing-maintainers)).
6. **Add the "What's new" page** in a pull request against `develop`: the same release in
   user-facing words, in English, Portuguese and Spanish. Save it as
   `apps/docs/content/docs/<locale>/whats-new/vX-Y-Z.mdx` for each of `en`, `pt` and `es`,
   and list `vX-Y-Z` right after `index` in each locale's `whats-new/meta.json`, so the
   newest release comes first. Start from this template:

   ```mdx
   ---
   title: WonderMoney X.Y.Z
   description: One sentence on what this release changes for people who use it.
   ---

   [Release notes on GitHub](https://github.com/wondermoney/wondermoney/releases/tag/vX.Y.Z)

   ## Upgrading

   {/* Self-hosters: migrations, new or changed settings, commands to run. Otherwise
   "Nothing to do." Link to the self-hosting pages rather than repeating them. */}

   ## New

   {/* One line per change people will notice, starting with what they can now do. */}

   ## Fixes

   ## Thanks to

   {/* The output of .github/scripts/release-thanks.sh, as on GitHub. */}
   ```

   In Portuguese the headings are "Atualizar", "Novo", "Correções" and "Agradecimentos"; in
   Spanish, "Actualizar", "Nuevo", "Correcciones" and "Agradecimientos". Leave out a section
   with nothing in it, except Upgrading.

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
