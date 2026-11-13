#!/usr/bin/env node
// The share of this machine one agent lane gets, and the names that keep its databases apart
// from other worktrees'. `scripts/verify-changed.mjs` imports it; run on its own, it prints the
// values as shell assignments:
//
//   node scripts/agent-env.mjs              # WM_AGENT_LANES=… lines, with how they were worked out
//   eval "$(node scripts/agent-env.mjs)"    # export them into the current shell
//
// Lanes: WM_AGENT_LANES when set, otherwise the git worktrees of this repository active in the
// last WM_AGENT_ACTIVE_MINUTES (default 60) minutes, counting this one. A worktree is active when
// its index, HEAD or HEAD reflog changed in that window (any commit, checkout, add, or a `git
// status` that refreshed the index).
// Workers per test run: max(1, floor(cores / lanes)), cores being os.availableParallelism().
// WM_MAX_WORKERS overrides it.
//
// Databases: WM_TEST_DB_PREFIX is `wm_<worktree directory>_<hash of its path>`, stable for a
// worktree and distinct between worktrees of the same name in different places. Scratch
// databases this worktree creates on the shared test Postgres start with it, so they never
// collide with another worktree's and can be found and dropped per worktree.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

export function repoRoot(cwd = process.cwd()) {
  return git(['rev-parse', '--show-toplevel'], cwd);
}

function lastActivity(worktree) {
  let gitDir;
  try {
    gitDir = git(['rev-parse', '--git-dir'], worktree);
  } catch {
    return 0; // a worktree whose directory is gone
  }
  if (!isAbsolute(gitDir)) gitDir = resolve(worktree, gitDir);
  let latest = 0;
  for (const file of ['index', 'HEAD', join('logs', 'HEAD')]) {
    try {
      latest = Math.max(latest, statSync(join(gitDir, file)).mtimeMs);
    } catch {
      // not there yet
    }
  }
  return latest;
}

/** Worktrees of this repository with git activity in the window, always including `root`. */
export function activeWorktrees(root = repoRoot()) {
  const minutes = Number(process.env.WM_AGENT_ACTIVE_MINUTES) || 60;
  const since = Date.now() - minutes * 60_000;
  const worktrees = git(['worktree', 'list', '--porcelain'], root)
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
  const active = worktrees.filter((path) => path === root || lastActivity(path) >= since);
  return { active, minutes, total: worktrees.length };
}

export function agentEnv(root = repoRoot()) {
  const cores = availableParallelism();
  const override = Number.parseInt(process.env.WM_AGENT_LANES ?? '', 10);
  const worktrees = activeWorktrees(root);
  const lanes = override > 0 ? override : Math.max(1, worktrees.active.length);
  const workersOverride = Number.parseInt(process.env.WM_MAX_WORKERS ?? '', 10);
  const maxWorkers = workersOverride > 0 ? workersOverride : Math.max(1, Math.floor(cores / lanes));
  const slug = basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'wt';
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 6);
  return {
    cores,
    dbPrefix: process.env.WM_TEST_DB_PREFIX || `wm_${slug}_${hash}`,
    lanes,
    lanesSource: override > 0 ? 'WM_AGENT_LANES' : `${worktrees.active.length} of ${worktrees.total} worktrees active in the last ${worktrees.minutes} min`,
    maxWorkers,
    maxWorkersSource: workersOverride > 0 ? 'WM_MAX_WORKERS' : `floor(${cores} cores / ${lanes} lanes)`,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = agentEnv();
  console.log(`# ${env.lanesSource}; workers: ${env.maxWorkersSource}`);
  console.log(`export WM_AGENT_LANES=${env.lanes}`);
  console.log(`export WM_MAX_WORKERS=${env.maxWorkers}`);
  console.log(`export VITEST_MAX_WORKERS=${env.maxWorkers}`);
  console.log(`export WM_TEST_DB_PREFIX=${env.dbPrefix}`);
}
