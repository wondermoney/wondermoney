---
name: verify-changed
description: The WonderMoney agent dev flow - verify a branch with `pnpm verify:changed` once after rebasing, push, and let CI run the full suites - plus the conventions that otherwise fail late in CI. Use before pushing or opening a pull request, when rebasing onto develop, and when a change touches migrations or entities, the data export format, pt-PT copy, docs MDX, IP addresses in tests, pg-boss queue names, or the API's swagger/OpenAPI documents.
---

# Verify a change

Several agents share one machine and one test Postgres, so every agent runs the same **tiered**
check, once, on exactly what its branch changed. CI runs the full suites.

## The loop

1. **While developing**, run only the test files you touch or that cover your change, with
   this worktree's share of the machine:
   ```bash
   eval "$(node scripts/agent-env.mjs)" && pnpm --dir apps/api exec vitest run <files>
   ```
2. **Rebase** onto the latest develop: commit (a WIP commit is fine), then
   `git fetch origin develop && git rebase origin/develop`. Resolve conflicts with
   [Conventions](#conventions): generated files and migrations are regenerated, never merged by
   hand.
3. **Verify once, after the rebase:** commit, then run `pnpm verify:changed`. The check is done
   when its summary ends `All passed`. On a `FAIL`, fix it, commit, and run it again; the
   summary lists every failed step, so fix them all before rerunning.
4. **Push** and let CI run the full suites.

A full suite runs locally only on demand: `pnpm verify:changed --full` adds the touched
packages' full suites, for changes whose reach tier 1 cannot see (test helpers, vitest or jest
config, setup files). One full suite at a time on this machine.

## What `pnpm verify:changed` runs

It diffs the working tree, commits and untracked files against the merge base with
`origin/develop` (`--base <ref>` for another), finds the workspace packages under the changed
paths (Markdown aside), and runs for those only. `--dry-run` prints the plan.

| Tier | Steps |
|---|---|
| 1 | `build:lib` when `packages/*` changed, then the tests related to the changed files: `vitest related` (api, web, landing, shared), `jest --findRelatedTests` (mobile, under Node 24 through volta or fnm), react-email's `test` |
| 2 | `type-check` of touched packages and of those depending on a changed library; ESLint on the changed files (docs: its whole `lint`, which carries the locale-parity checks) |
| 3 | `leak-check.sh` and gitleaks over the branch's commits; the docs build when `apps/docs` changed; API `openapi --check` (routes, validators, `src/openapi`); swagger regenerated and compared (routes, validators, controllers); `migrate:dev` plus `migrate:dev:check` on a scratch database when migrations or entities changed |

Every step runs even after a failure; the exit code is 1 when any failed. Tier 3 reads commits,
so commit before the run that counts.

**Database.** Set `TEST_POSTGRES_URL` to the shared test Postgres (a server URL whose database
already exists, such as `wmdb`) to run the DB-backed tests (`describe.runIf(TEST_POSTGRES_URL)`)
and the migration check. Without it those tests skip and the summary marks the migration check
skipped.

**Budget.** `scripts/agent-env.mjs` sets the test workers to `max(1, floor(cores / lanes))`.
Lanes are the git worktrees of this repository whose index, HEAD or reflog changed in the last
60 minutes (`WM_AGENT_ACTIVE_MINUTES`), counting this one. `WM_AGENT_LANES` overrides the lane
count and `WM_MAX_WORKERS` the result. The workers reach vitest as `VITEST_MAX_WORKERS` and jest
as `--maxWorkers`; type-check, lint and the builds run one at a time.

**Scratch databases** are named `<WM_TEST_DB_PREFIX>_<suffix>`, a prefix stable per worktree
(`wm_<directory>_<path hash>`), so worktrees never touch each other's:

```bash
node scripts/scratch-db.mjs create mig   # (re)create it empty; prints the API's DB env for it
node scripts/scratch-db.mjs list         # this worktree's databases
node scripts/scratch-db.mjs drop mig     # or drop-all
```

## Conventions

**Export format version.** `EXPORT_FORMAT_VERSION` in
`apps/api/src/services/data-export/export-format.ts` is the one place the version is written.
Tests import the constant. A change to the export bumps the minor and adds its line to the
comment above it; when develop has moved the version while you worked, take the next minor
after develop's at the rebase.

**Migrations.** MikroORM applies migrations in name order, so a new migration's timestamp must
sort after every migration on develop. After a rebase that brought in migrations, or on a
conflict in `.snapshot-wmdb.json`, take develop's snapshot and regenerate yours:

```bash
git checkout origin/develop -- apps/api/src/database/migrations/.snapshot-wmdb.json
rm apps/api/src/database/migrations/Migration<yours>.ts
env $(node scripts/scratch-db.mjs create mig) pnpm --filter @wondermoney/api migrate:dev
env $(node scripts/scratch-db.mjs env mig) pnpm --filter @wondermoney/api migrate:dev:create
node scripts/scratch-db.mjs drop mig
```

Review that the new file's SQL is the DDL you intend, and commit it with the snapshot.
Migrations are DDL only; the rest of the rules are in `apps/api/CLAUDE.md`.

**pt-PT copy** addresses the reader as **tu** ("Introduz o teu email", "Clica em Guardar") and
the product as **o WonderMoney**. Buttons and menu items stay infinitive. `CONTRIBUTING.md` has
the table; the web and mobile `pt-form-of-address` tests enforce it.

**Docs MDX** reads `<word>` as a JSX tag, so a placeholder goes in inline code: `` `<name>` ``.
Only the docs build catches it; type-check and lint pass. en, pt and es pages stay in step.

**IP addresses** outside loopback, private (RFC 1918) and documentation (RFC 5737) ranges fail
the leak check. Examples use `192.0.2.x`, `198.51.100.x` or `203.0.113.x`. A test that needs a
public address builds it at runtime: `[34, 120, 0, 10].join('.')`. A false positive gets an
exact-value entry in `.github/leak-allow.txt` or `.gitleaks.toml`, never a path or whole rule
(`CONTRIBUTING.md`, "Leak check").

**pg-boss names.** Queue names and schedule keys match `/^[\w.\-/]+$/`: letters, digits, `_`,
`.`, `-` and `/`. pg-boss asserts this when the worker starts, and unit tests mock pg-boss, so
check a new name against the regex in a test, as
`apps/api/src/jobs/__tests__/push-send.queue.test.ts` does.

**Generated API documents.** `apps/api/src/generated/swagger.json` and
`apps/docs/openapi/wondermoney.json` are regenerated, never merged by hand. On a conflict take
either side, then run `pnpm --filter @wondermoney/api swagger` and
`pnpm --filter @wondermoney/api openapi`, and commit the results.
