#!/usr/bin/env node
// Verifies what this branch changes, and only that, before it is pushed: the agent loop of
// .claude/skills/verify-changed/SKILL.md. CI runs the full suites.
//
//   pnpm verify:changed              # tiers 1-3 for the packages the branch touches
//   pnpm verify:changed --dry-run    # print the plan and run nothing
//   pnpm verify:changed --full       # also the touched packages' full test suites
//   pnpm verify:changed --base <ref> # compare with <ref> instead of origin/develop
//
// The change is everything between the merge base with the base ref and the working tree:
// commits, staged and unstaged edits, and untracked files. A package is touched when a changed
// path other than Markdown is under its directory.
//   Tier 1: build:lib when a library package changed, then the tests related to the changed
//           files (vitest related, jest --findRelatedTests).
//   Tier 2: type-check of the touched packages and of the packages that depend on a changed
//           library; ESLint on the changed files.
//   Tier 3: the checks that otherwise fail only in CI: leak-check.sh and gitleaks over the
//           branch's commits, the docs build, the API's OpenAPI and swagger documents, and the
//           migration chain and snapshot on a scratch database.
// Every step runs, even after a failure; the exit code is 1 when any failed. Test workers come
// from scripts/agent-env.mjs (cores divided by active worktrees).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { agentEnv, repoRoot } from './agent-env.mjs';
import { createDatabase, databaseEnv, dropDatabase, scratchName } from './scratch-db.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
if (flag('--help') || flag('-h')) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(0);
}
const DRY_RUN = flag('--dry-run');
const FULL = flag('--full');
const BASE_REF = option('--base', 'origin/develop');

const ROOT = repoRoot();
const env = agentEnv(ROOT);
const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const lines = (text) => text.split('\n').filter(Boolean);

// Part A of #316 may split the API suite into `test:unit` and `test:db`. A full run uses the
// first entry of this list whose scripts the package defines all of.
const FULL_SUITE_SCRIPTS = [['test:unit', 'test:db'], ['test']];

const CODE = /\.(c|m)?(j|t)sx?$/;
const LINTABLE = /\.(c|m)?(j|t)sx?$/;

/**
 * What each workspace package runs. `tests`: how tier 1 picks related tests ('vitest', 'jest',
 * 'script' to run its `test` script whole, or none). `lint`: 'files' (ESLint on the changed
 * files, with `lintArgs`), 'script' (its `lint` script whole) or none. `node`: a .nvmrc the
 * package's tooling must run under. A package missing here gets type-check and its `lint` script.
 */
const PACKAGES = {
  'apps/api': { tests: 'vitest', lint: 'files', lintEnv: { NODE_OPTIONS: '--max-old-space-size=4096' } },
  'apps/docs': { lint: 'script', build: true },
  'apps/landing': { tests: 'vitest', lint: 'files', lintPattern: /\.(c|m)?(j|t)sx?$|\.astro$/ },
  'apps/mobile': { tests: 'jest', lint: 'files', node: 'apps/mobile/.nvmrc' },
  'apps/web': { tests: 'vitest', lint: 'files', lintArgs: ['--max-warnings=0'] },
  'packages/react-email': { tests: 'script', library: true },
  'packages/shared': { tests: 'vitest', lint: 'files', library: true },
};

// ---------------------------------------------------------------------------------------------
// The change.

let base;
try {
  base = git('merge-base', 'HEAD', BASE_REF);
} catch {
  console.error(`No merge base with ${BASE_REF}. Run \`git fetch origin develop\` (or pass --base <ref>).`);
  process.exit(2);
}
const commits = lines(git('rev-list', '--no-merges', `${base}..HEAD`)).length;
const changed = [...new Set([...lines(git('diff', '--name-only', '--no-renames', base)), ...lines(git('ls-files', '--others', '--exclude-standard'))])].sort();
const dirty = git('status', '--porcelain') !== '';
const exists = (file) => existsSync(join(ROOT, file));

const workspace = Object.fromEntries(
  ['apps', 'packages'].flatMap((group) =>
    readdirSync(join(ROOT, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(ROOT, group, entry.name, 'package.json')))
      .map((entry) => {
        const dir = `${group}/${entry.name}`;
        const manifest = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
        return [dir, { dir, manifest, name: manifest.name, scripts: manifest.scripts ?? {}, ...(PACKAGES[dir] ?? { lint: 'script' }) }];
      }),
  ),
);
// Markdown (agent guides, READMEs) is no package change; the docs site's pages are .mdx.
const touched = Object.values(workspace)
  .map((pkg) => ({ ...pkg, files: changed.filter((file) => file.startsWith(`${pkg.dir}/`) && !file.endsWith('.md')) }))
  .filter((pkg) => pkg.files.length > 0);
const touchedNames = new Set(touched.map((pkg) => pkg.name));
const libraries = touched.filter((pkg) => pkg.library);
const dependsOn = (pkg, names) => Object.keys({ ...pkg.manifest.dependencies, ...pkg.manifest.devDependencies }).some((dep) => names.has(dep));
const libraryNames = new Set(libraries.map((pkg) => pkg.name));
const dependents = Object.values(workspace).filter((pkg) => !touchedNames.has(pkg.name) && dependsOn(pkg, libraryNames));
const rootFiles = changed.filter((file) => !/^(apps|packages)\//.test(file));
const any = (pattern) => changed.some((file) => pattern.test(file));

// ---------------------------------------------------------------------------------------------
// The plan: a list of steps, each a command or a function.

const steps = [];
const childEnv = { ...process.env, VITEST_MAX_WORKERS: String(env.maxWorkers), WM_TEST_DB_PREFIX: env.dbPrefix };
const nodeMajor = Number(process.versions.node.split('.')[0]);
const commandExists = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;

/** Prefix that runs a command under the Node version a package's .nvmrc names. */
function nodeFor(pkg) {
  if (!pkg.node) return { prefix: [] };
  const wanted = readFileSync(join(ROOT, pkg.node), 'utf8').trim().replace(/^v/, '');
  if (Number(wanted.split('.')[0]) === nodeMajor) return { prefix: [] };
  if (commandExists('volta')) return { prefix: ['volta', 'run', '--node', wanted] };
  if (commandExists('fnm')) return { prefix: ['fnm', 'exec', `--using=${wanted}`] };
  return { note: `on Node ${nodeMajor}: no volta or fnm to switch to Node ${wanted}`, prefix: [] };
}

function add(tier, label, command, options = {}) {
  steps.push({ tier, label, command, ...options });
}
const skip = (tier, label, reason) => steps.push({ tier, label, skip: reason });

function cmd(pkg, argv, extra = {}) {
  const { prefix, note } = nodeFor(pkg);
  return { argv: [...prefix, ...argv], cwd: join(ROOT, pkg.dir), env: extra.env, note };
}

const inPkg = (pkg, file) => relative(pkg.dir, file);
const existing = (pkg) => pkg.files.filter(exists);

// Tier 1: related tests, after rebuilding a changed library the apps import from its dist/.
if (libraries.length > 0) {
  add(1, 'build:lib', { argv: ['pnpm', 'build:lib'], cwd: ROOT });
}
for (const pkg of touched) {
  const label = `${pkg.name.replace('@wondermoney/', '')}: related tests`;
  const sources = existing(pkg).filter((file) => CODE.test(file) || file.endsWith('.json')).map((file) => inPkg(pkg, file));
  if (pkg.tests === 'script') {
    if (pkg.scripts.test) add(1, `${pkg.name.replace('@wondermoney/', '')}: test`, cmd(pkg, ['pnpm', 'run', 'test']));
    continue;
  }
  if (!pkg.tests) continue;
  if (sources.length === 0) {
    skip(1, label, 'no changed source files');
    continue;
  }
  if (pkg.tests === 'vitest') {
    add(1, label, cmd(pkg, ['pnpm', 'exec', 'vitest', 'related', '--run', '--passWithNoTests', ...sources]));
  } else if (pkg.tests === 'jest') {
    add(1, label, cmd(pkg, ['pnpm', 'exec', 'jest', '--findRelatedTests', ...sources, '--passWithNoTests', `--maxWorkers=${env.maxWorkers}`]));
  }
}
if (FULL) {
  for (const pkg of touched) {
    const short = pkg.name.replace('@wondermoney/', '');
    if (pkg.tests === 'jest') {
      add(1, `${short}: full suite`, cmd(pkg, ['pnpm', 'exec', 'jest', `--maxWorkers=${env.maxWorkers}`]));
      continue;
    }
    if (pkg.tests === 'script') continue; // tier 1 already ran its whole `test`
    const scripts = FULL_SUITE_SCRIPTS.find((set) => set.every((name) => pkg.scripts[name]));
    for (const script of scripts ?? []) add(1, `${short}: full suite (${script})`, cmd(pkg, ['pnpm', 'run', script]));
  }
}

// Tier 2: type-check, lint.
for (const pkg of [...touched, ...dependents]) {
  const short = pkg.name.replace('@wondermoney/', '');
  if (pkg.scripts['type-check']) add(2, `${short}: type-check${touchedNames.has(pkg.name) ? '' : ' (dependent)'}`, cmd(pkg, ['pnpm', 'run', 'type-check']));
}
for (const pkg of touched) {
  const short = pkg.name.replace('@wondermoney/', '');
  if (pkg.lint === 'script' && pkg.scripts.lint) {
    add(2, `${short}: lint`, cmd(pkg, ['pnpm', 'run', 'lint']));
  } else if (pkg.lint === 'files') {
    const files = existing(pkg).filter((file) => (pkg.lintPattern ?? LINTABLE).test(file)).map((file) => inPkg(pkg, file));
    if (files.length === 0) skip(2, `${short}: lint`, 'no changed lintable files');
    else add(2, `${short}: lint (${files.length} file${files.length === 1 ? '' : 's'})`, cmd(pkg, ['pnpm', 'exec', 'eslint', '--no-warn-ignored', ...(pkg.lintArgs ?? []), ...files], { env: pkg.lintEnv }));
  }
}

// Tier 3: CI-only checks.
const range = commits > 0 ? `${base}..HEAD` : '';
add(3, 'leak check', { argv: ['.github/scripts/leak-check.sh', ...(range ? [range] : [])], cwd: ROOT });
if (!commandExists('gitleaks')) skip(3, 'gitleaks', 'gitleaks is not installed');
else if (!range) skip(3, 'gitleaks', 'no commits on the branch yet');
else add(3, 'gitleaks', { argv: ['gitleaks', 'git', '.', '--config', '.gitleaks.toml', '--redact', '--no-banner', '--exit-code', '1', `--log-opts=--no-merges ${range}`], cwd: ROOT });

const api = workspace['apps/api'];
const docs = workspace['apps/docs'];
if (touchedNames.has(docs?.name)) add(3, 'docs build', cmd(docs, ['pnpm', 'run', 'build']));
if (any(/^apps\/api\/src\/(routes|validators|openapi)\/|^apps\/docs\/openapi\//)) {
  add(3, 'api: openapi --check', cmd(api, ['pnpm', 'run', 'openapi', '--', '--check']));
}
if (any(/^apps\/api\/src\/(routes|validators|controller)\/|^apps\/api\/src\/app\.ts$|^apps\/api\/src\/generated\/swagger\.json$/)) {
  add(3, 'api: swagger is current', swaggerCheck);
}
if (any(/^apps\/api\/src\/database\/(migrations|entity)\/|^apps\/api\/src\/mikro-orm\.config\.ts$/)) {
  if (process.env.TEST_POSTGRES_URL) add(3, 'api: migrations and snapshot', migrationCheck);
  else skip(3, 'api: migrations and snapshot', 'TEST_POSTGRES_URL is not set');
}

// ---------------------------------------------------------------------------------------------
// Tier 3 checks that need more than one command.

/** Regenerates swagger.json the way CI does; a change means the committed one was stale. */
function swaggerCheck(run) {
  const file = join(ROOT, 'apps/api/src/generated/swagger.json');
  const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (!run(cmd(api, ['pnpm', 'run', 'swagger']))) return false;
  if (readFileSync(file, 'utf8') === before) return true;
  console.error('apps/api/src/generated/swagger.json was stale. It is regenerated in place: review and commit it.');
  return false;
}

/** Applies the whole chain to a scratch database, then checks the snapshot, as CI's API job does. */
async function migrationCheck(run) {
  const database = scratchName('migrations');
  const migrations = () => git('status', '--porcelain', '--', 'apps/api/src/database/migrations');
  await createDatabase(database);
  try {
    const dbEnv = databaseEnv(database);
    const before = migrations();
    if (!run(cmd(api, ['pnpm', 'run', 'migrate:dev'], { env: dbEnv }))) return false;
    if (migrations() !== before) {
      console.error('Applying the migrations changed src/database/migrations: migration apply must not write the snapshot.');
      return false;
    }
    if (!run(cmd(api, ['pnpm', 'run', 'migrate:dev:check'], { env: dbEnv }))) {
      console.error('The snapshot does not match the entities: regenerate it (.claude/skills/verify-changed/SKILL.md, "Migrations").');
      return false;
    }
    return true;
  } finally {
    await dropDatabase(database);
  }
}

// ---------------------------------------------------------------------------------------------
// Run.

const show = (command) => `${command.cwd === ROOT ? '' : `(${relative(ROOT, command.cwd)}) `}${command.env ? `${Object.keys(command.env).join(' ')}=… ` : ''}${command.argv.join(' ')}`;

console.log(`Base: ${BASE_REF} at ${base.slice(0, 10)} · ${commits} commit${commits === 1 ? '' : 's'} · ${changed.length} changed file${changed.length === 1 ? '' : 's'}${dirty ? ' (working tree not clean)' : ''}`);
console.log(`Packages: ${touched.map((pkg) => `${pkg.name} (${pkg.files.length})`).join(', ') || 'none'}${rootFiles.length ? ` · ${rootFiles.length} outside apps/ and packages/` : ''}`);
console.log(`Lanes: ${env.lanes} (${env.lanesSource}) · test workers: ${env.maxWorkers} (${env.maxWorkersSource}) · scratch database prefix: ${env.dbPrefix}`);
if (dirty) console.log('Note: gitleaks and the leak check read commits; commit before the last run.');

if (DRY_RUN) {
  for (const step of steps) {
    const what = step.skip ? `skip: ${step.skip}` : typeof step.command === 'function' ? `${step.command.name} (see scripts/verify-changed.mjs)` : show(step.command);
    console.log(`  [${step.tier}] ${step.label.padEnd(44)} ${what}`);
  }
  process.exit(0);
}

const results = [];
function runCommand(command) {
  if (command.note) console.log(`note: ${command.note}`);
  console.log(`$ ${show(command)}`);
  const result = spawnSync(command.argv[0], command.argv.slice(1), { cwd: command.cwd, env: { ...childEnv, ...command.env }, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  return result.status === 0;
}
for (const step of steps) {
  if (step.skip) {
    results.push({ ...step, status: 'skip', note: step.skip, seconds: 0 });
    continue;
  }
  console.log(`\n── [tier ${step.tier}] ${step.label}`);
  const started = Date.now();
  let ok;
  try {
    ok = typeof step.command === 'function' ? await step.command(runCommand) : runCommand(step.command);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    ok = false;
  }
  results.push({ ...step, note: step.command.note, seconds: (Date.now() - started) / 1000, status: ok ? 'pass' : 'FAIL' });
}

console.log('\nverify:changed');
for (const r of results) {
  console.log(`  ${r.status.padEnd(5)} [${r.tier}] ${r.label.padEnd(44)} ${r.seconds ? `${r.seconds.toFixed(0).padStart(4)}s` : '     '}${r.note ? `  ${r.note}` : ''}`);
}
const failed = results.filter((r) => r.status === 'FAIL').length;
const total = results.reduce((sum, r) => sum + r.seconds, 0);
console.log(failed ? `${failed} failed, ${total.toFixed(0)}s` : `All passed, ${total.toFixed(0)}s. Push and let CI run the full suites.`);
process.exit(failed ? 1 : 0);
