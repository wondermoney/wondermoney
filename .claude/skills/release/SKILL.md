---
name: release
description: Releases WonderMoney to production and brings every surface into sync - merges the prepared develop to main pull request, tags and publishes the release notes, updates the docs and render.yaml, and builds and submits the mobile app. Use when asked to deploy to production, release, ship a version, or submit or roll out the mobile app.
---

# Release

A release is finished when every surface is **in sync**: production, the tag, the self-hosting
images and chart, `render.yaml`, the "What's new" page and both app stores all carry the same
changes, or the report says which one is behind and why.

`CONTRIBUTING.md` ("Releasing" and "Release notes") and `apps/mobile/README.md` ("Releasing")
hold the commands. This skill is the order, the gates and the report.

## Steps

1. **Start from the prepared section** of the release pull request
   (`gh pr list --base main --head develop --state open`). It must exist, and its SHA must be
   `origin/develop`'s head. Otherwise run the `prepare-deploy` skill first.

2. **Before.** Work through "Before deploying" and tick each box in the pull request as it is
   done. Two gates stop the release until they hold:
   - a backup the section calls for is confirmed by the maintainer, in this conversation;
   - the required check is green on `develop`'s head (`gh pr checks <n>`). If it is missing,
     run CI on `develop` (`gh workflow run ci.yml --ref develop`).

3. **Merge.** `gh pr merge <n> --merge`. This deploys production.

4. **Watch.** `gh run list --branch main --limit 6`, then `gh run watch <id>` for each deploy
   the blast radius said would run. A failed deploy is reported at once, with the failing step
   (`gh run view <id> --log-failed`); the remaining steps wait.

5. **After.** Work through "After the deploy": each check, each one-off script. Tick the boxes.

6. **Tag and notes** (`CONTRIBUTING.md`, "Release notes", steps 2 to 5): create the draft with
   `--generate-notes --notes-start-tag <previous tag>`, then replace its body with an
   **Upgrading** section first (migrations and whether to back up, new or changed settings,
   commands to run, or "Nothing to do"), the prepared changelog with its sections, and the
   output of `.github/scripts/release-thanks.sh`. Publish it. The tag starts
   `publish-images.yml`; wait for it to finish.

7. **Follow-up pull request** against `develop`, once the images are published:
   - the "What's new" page in en, pt and es, listed first in each `whats-new/meta.json`
     (`CONTRIBUTING.md`, "Release notes", step 6);
   - the three image tags in `render.yaml` set to the new version.

   Verify it with `pnpm verify:changed`, and merge it when green.

8. **Mobile**, when `apps/mobile` changed since the version in the stores:
   - build and submit both platforms as `apps/mobile/README.md` sets out, under Node 24;
   - the stores' "what's new" text is the changelog's ✨, 🛠, 🐛 and 📱 lines that apply to
     mobile, in each store language;
   - Android starts as a staged rollout at the share `eas.json` sets (`submit.production`).
     Raise it to 100% when the maintainer says so; until then the report shows the share.

   `eas build:list --limit 4 --non-interactive --json` shows build state. Store review takes
   hours to days, so report the submission and move on.

9. **Report in sync.** One row per surface, with the version or commit it carries and its
   state:

   | Surface | Carries | State |
   |---|---|---|
   | Production API and worker | `main` SHA | deployed, migrations applied |
   | Production web | `main` SHA | deployed |
   | Docs and landing | `main` SHA | deployed, or unchanged |
   | Tag and GitHub release | `vX.Y.Z` | published |
   | Images and Helm chart | `X.Y.Z` | published |
   | `render.yaml` | `X.Y.Z` | merged to `develop` |
   | "What's new" page | `vX-Y-Z` | merged to `develop`, live after the next release |
   | iOS | app version, build | submitted, in review or live |
   | Android | app version, build | rollout share |

   A row that is behind says what it waits for and who acts.

## When something goes wrong

The way back is forward: revert the offending pull request on `develop`, prepare, and release
again. A shipped migration stays; a new migration corrects it. Restoring a backup is the
maintainer's decision.
