---
name: prepare-deploy
description: Prepares a production release - finds or opens the develop to main pull request, checks whether the docs need updating, and writes a changelog, the blast radius and pre, during and post deploy instructions into it. Use when asked to prepare a deploy or a release, or what a release would contain.
---

# Prepare a deploy

Preparing changes nothing in production. It ends with the release pull request carrying a
**prepared section** that the person can read and the `release` skill can follow. Merging is
the `release` skill's.

## Steps

1. **Find the release.**
   ```bash
   git fetch origin main develop --tags
   git log --first-parent --format='%h %s' origin/main..origin/develop
   gh pr list --base main --head develop --state open --json number,url
   ```
   An empty log means there is nothing to release: say so and stop. With no open pull request,
   open one: `gh pr create --base main --head develop --title 'Release: develop → main'`.

2. **Read every change.** For each pull request in the log:
   `gh pr view <n> --json title,labels,body,files`. A pull request without a release-notes
   label gets one now (`CONTRIBUTING.md`, "Release notes"), so the generated notes group
   correctly. Note the surfaces each one touches.

3. **Check the docs.** For each change a user or a self-hoster would notice, find the page that
   should describe it and read it:
   - feature pages under `apps/docs/content/docs/{en,pt,es}`, the three locales in step;
   - a new or changed setting: `apps/api/.env.sample`,
     `apps/docs/content/docs/*/self-hosting/configure.mdx`, and `render.yaml` when it is
     required;
   - the API reference when routes changed (`apps/docs/openapi/wondermoney.json`);
   - `README.md`, and the landing page's claims when a claim became true or false.

   List each gap as **missing** or **stale**, with the page. Gaps are fixed in a pull request
   against `develop`; once it merges, prepare again. The person may choose to release with a
   gap open: record that choice in the section.

4. **Versions.** The server version follows the last tag (`git describe --tags --abbrev=0
   origin/main`): a feature raises the minor, fixes alone the patch. Mobile has its own
   `version` in `apps/mobile/app.config.ts`; when `apps/mobile` changed in this release and
   that version equals the one in the stores, the bump goes in as a pull request against
   `develop` first.

5. **Write the changelog** for people who use and run WonderMoney, one line per change they
   would notice, in plain words with the pull request or issue number. Group related pull
   requests into one line, and leave out refactors, tests and tooling. Sections, in this
   order, only those with entries:

   | Section | Holds |
   |---|---|
   | ✨ New | features people can now use |
   | 🛠 Improved | changes to something that existed |
   | 🐛 Fixed | bugs, described by what the person saw |
   | 🔒 Security and privacy | fixes and hardening |
   | 📱 Mobile | what changed in the iOS and Android app only |
   | 🏠 Self-hosting | settings, images, chart, install and upgrade |
   | 🌍 Translations | new languages and copy |
   | 📚 Docs | new and rewritten pages |

6. **Work out the blast radius.** One row per surface, each marked changed or untouched, with
   what could go wrong and how it would show:

   | Surface | Deploys through | Look at |
   |---|---|---|
   | API and worker | `api-production.yml`, on changes under `apps/api`, `packages` or the lockfile | routes, jobs, queues and schedules, integrations |
   | Database | the API applies pending migrations when it starts | each new file under `apps/api/src/database/migrations`: read its SQL and class it **additive**, **constraint-changing** or **destructive** |
   | Web | `web-production.yml`, on changes under `apps/web` or the lockfile | pages and flows changed |
   | Docs and landing | their Vercel projects, when their directory changed | pages changed, in every locale |
   | Mobile | a store release, separately | whether released clients still work against the new API |
   | Self-hosters | the next tag: images, Helm chart, `render.yaml` | new required settings, upgrade steps |
   | Data contracts | with the API | export format version, API response shapes, emails, push notifications |

   Then three lines: the **riskiest change** and why; **who is affected** if it goes wrong
   (everyone, households with a given feature, self-hosters only); and the **way back**
   (revert the pull request on `develop` and release again; a shipped migration is immutable,
   so the database moves forward with a new one).

7. **Write the instructions**, each step a checkbox, each naming who does it (agent or
   maintainer):
   - **Before**: a database backup when any migration is constraint-changing or destructive;
     new settings to set on the hosted instance, by name; docs gaps resolved; the required
     check green on `develop`'s head.
   - **During**: merge with a merge commit; the workflows that will run and what a healthy run
     looks like; migrations applied at API start.
   - **After**: what to open and try, one check per changed surface; one-off scripts to run;
     the tag, release notes, `render.yaml` and "What's new" page; the mobile build and store
     submission when mobile changed.

8. **Write the prepared section** into the pull request body. `release-pr.yml` rewrites the
   body on every push to `develop` and keeps whatever sits between the two markers, so the
   section goes between them, replacing an earlier one:

   ```markdown
   <!-- prepare-deploy:start -->
   ## Prepared release vX.Y.Z

   Prepared for `<full SHA of origin/develop>` on YYYY-MM-DD.

   ### Changelog
   ### Docs check
   ### Blast radius
   ### Before deploying
   ### During the deploy
   ### After the deploy
   <!-- prepare-deploy:end -->
   ```

   ```bash
   gh pr view <n> --json body --jq .body > body.md   # edit the section in, then:
   gh pr edit <n> --body-file body.md
   ```

9. **Report** to the person: the pull request link, the version, the changelog, the docs gaps,
   the riskiest change, and the steps under "Before deploying" that are theirs.

## Done

Every pull request in the range is in the changelog or deliberately left out, every surface has
a blast-radius row, every migration is classed, and the section's SHA is `origin/develop`'s
head. A push to `develop` after that makes the section **stale**: prepare again.
