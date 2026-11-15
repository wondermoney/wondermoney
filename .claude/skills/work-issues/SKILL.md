---
name: work-issues
description: The lead's loop for implementing open GitHub issues with parallel issue-worker agents, each in its own git worktree, through review, pull request and merge. Use when asked to work on, continue or keep working on the issues or the backlog.
---

# Work the issues

You are the lead. Workers implement; you choose the issues, brief the workers, review, ship and
merge. Keep **three lanes** busy until no ready issue is left (the person may name another
number): the moment a lane frees up, fill it.

## The loop

1. **Pick.** List the candidates and take the highest priority first:
   ```bash
   gh issue list --state open --label ready-for-agent --json number,title,labels
   ```
   Skip an issue that has an open pull request, is labelled `epic` or `ready-for-human`, or is
   blocked by an open issue. Two issues that edit the same files run one after the other. An
   issue with an open product decision goes through the `shape-issue` skill first.

2. **Worktree.** One per issue, a sibling directory of this checkout, on a fresh branch:
   ```bash
   git fetch origin develop
   git worktree add ../t<issue> -b <type>/<short-slug> origin/develop
   ```

3. **Dispatch** an `issue-worker` agent in the background. Its brief carries only what it
   cannot find itself: the issue number, the worktree's absolute path, the branch, the
   `TEST_POSTGRES_URL` of this machine's test Postgres, decisions already taken (binding), and
   files another running worker owns.

4. **Review** when the worker reports. Read the diff yourself
   (`git -C <worktree> diff origin/develop...HEAD`); the report is a claim. For anything beyond
   copy or docs, dispatch a `pr-reviewer` agent on the branch. Send blocking findings back to
   the same worker with SendMessage, and review again.

5. **Ship.** Push the branch and open the pull request against `develop`, following
   `.github/pull_request_template.md`, with `Closes #<issue>` and the worker's verify summary
   under "How it was tested". Add the release-notes label (`CONTRIBUTING.md`, "Release notes":
   `enhancement`, `bug`, `security`, `self-hosting`, `translations`, `documentation`) and the
   area labels. The release notes are grouped by these labels, so every pull request gets one.

6. **Merge when green.** `gh pr checks <n> --watch`, then
   `gh pr merge <n> --merge --delete-branch`. On a failed check, read the log
   (`gh run view <id> --log-failed`) and send the failure to the worker. A pull request that
   conflicts after another merge goes back to its worker to rebase and verify again.

7. **Close the lane.** `git worktree remove ../t<issue>` and delete the local branch. File an
   issue for each follow-up the worker or reviewer named, linked to its epic, in the form the
   tracker uses (Problem, Proposal, Acceptance criteria). Then go to step 1.

## Keeping the lanes honest

- **A slow worker.** A worker silent for 30 minutes gets a message asking where it is. The
  usual causes are a full test suite run locally or a test timing out under load; both are
  answered by the verify-changed skill (related tests only, `pnpm verify:changed` once).
- **Reporting.** Before telling the person what is running, check it: the agents actually
  alive, `git worktree list`, `gh pr list`. Report lanes as issue, state (implementing, in
  review, waiting on CI, merged) and the pull request number.
- **Decisions.** Something only the person can decide is asked as a multiple-choice question
  with one recommendation. The other lanes keep going meanwhile.

## Done

The loop ends when no open issue is ready for an agent and every lane is closed: each
dispatched issue is merged, or handed back with the reason. End with the list of what merged,
what is waiting on the person, the follow-up issues filed, and what the next release would
contain (`git log --first-parent --oneline origin/main..origin/develop`).
