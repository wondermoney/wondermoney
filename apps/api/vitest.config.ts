import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { configDefaults, defineConfig, type TestProjectInlineConfiguration } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_FILES = 'src/**/*.{test,spec}.{ts,tsx}';
// Timing assertions (`*.perf.test.ts`) only mean something on a quiet machine, so they are not part
// of `vitest run`: `pnpm test:perf` (VITEST_PERF=1) runs them, against TEST_POSTGRES_URL.
const PERF_FILES = 'src/**/*.perf.test.ts';
const perfEnabled = process.env['VITEST_PERF'] === '1';
// The test files that start a database (`__helpers__/pg-test-db.ts`). They form the "db" project and
// the rest the "unit" project, so `--project unit` is the quick loop that needs no database.
const databaseTests = globSync(TEST_FILES, { cwd: __dirname, exclude: [PERF_FILES] })
  .filter((file) => /__helpers__\/pg-test-db['"]/.test(readFileSync(path.join(__dirname, file), 'utf8')))
  .sort();
// Registers the run on TEST_POSTGRES_URL that owns, and cleans up, the run's test databases.
const pgTestRun = './src/__tests__/__helpers__/pg-test-run.ts';

const projects: TestProjectInlineConfiguration[] = [
  { extends: true, test: { exclude: [...configDefaults.exclude, PERF_FILES, ...databaseTests], include: [TEST_FILES], name: 'unit' } },
  { extends: true, test: { globalSetup: [pgTestRun], include: databaseTests, name: 'db' } },
  ...(perfEnabled ? [{ extends: true, test: { globalSetup: [pgTestRun], include: [PERF_FILES], name: 'perf' } }] : []),
];

// CI splits the suite across runners (`--shard=i/n --reporter=blob`). A shard's coverage is
// partial by construction, so a shard (VITEST_COVERAGE_PARTIAL=1) only records it into its blob;
// the merge job (`vitest run --merge-reports --coverage`) reports it and enforces the thresholds
// once, on the whole suite.
const partialCoverage = process.env.VITEST_COVERAGE_PARTIAL === '1';

export default defineConfig({
  resolve: {
    alias: {
      '@app': path.resolve(__dirname, 'src'),
      '@config': path.resolve(__dirname, 'src/config'),
      '@controller': path.resolve(__dirname, 'src/controller'),
      '@entity': path.resolve(__dirname, 'src/database/entity'),
      '@middleware': path.resolve(__dirname, 'src/middleware'),
      '@openapi': path.resolve(__dirname, 'src/openapi'),
      '@route': path.resolve(__dirname, 'src/routes/v1'),
      '@service': path.resolve(__dirname, 'src/services'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@validators': path.resolve(__dirname, 'src/validators'),
    },
  },
  test: {
    coverage: {
      exclude: [
        '**/__tests__/**',
        '**/__mocks__/**',
        '**/*.d.ts',
        '**/migrations/**',
        '**/seeds/**',
        '**/mikro-orm.config.ts',
        '**/app.ts',
        '**/server.ts',
        'src/test/**',
      ],
      // `src/jobs`, `src/middleware`, `src/config` and `src/routes` were absent for a long
      // time, which meant the worker — where most of the scheduling, claiming and email-send
      // logic lives — reported no coverage at all. They were not untested; they were
      // uncounted. Adding them moved the headline number by less than half a point, because
      // they are covered about as well as the directories that were already here.
      //
      // `src/routes/v1` reads oddly and honestly: ~96% statements against ~14% functions,
      // because a route file is mostly `router.get(...)` declarations that execute on import
      // while the handlers behind them are never invoked through the router. That gap is worth
      // seeing rather than hiding.
      include: [
        'src/config/**/*.ts',
        'src/controller/**/*.ts',
        'src/database/repositories/**/*.ts',
        'src/jobs/**/*.ts',
        'src/middleware/**/*.ts',
        'src/routes/**/*.ts',
        'src/services/**/*.ts',
        'src/utils/**/*.ts',
      ],
      provider: 'v8',
      reporter: partialCoverage ? [] : ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      // Ratcheted to roughly three points below the measured numbers, which leaves room for an
      // ordinary change to dip without failing CI while still catching a real regression. The
      // previous values (63/67/66/66) were set before `src/jobs`, `src/middleware`, `src/config`
      // and `src/routes` were instrumented and sat 8-15 points below reality, so the gate could
      // not have caught anything. Raise these again when the numbers move, not before.
      //
      // Long-term target from CLAUDE.md remains 80% statements / 75% branches.
      thresholds: partialCoverage ? undefined : {
        branches: 68,
        functions: 75,
        lines: 77,
        statements: 75,
      },
    },
    environment: 'node',
    globals: true,
    // Under load (parallel worktrees on one machine) a hook that boots the app or a database can
    // outlast vitest's 10 s default; a slow setup is not a failing test.
    hookTimeout: 30_000,
    // Each project names its own files: `extends: true` concatenates arrays, so a root `include`
    // would add every test file to every project.
    projects,
    setupFiles: ['./vitest.setup.ts', './src/test/setup.ts'],
    // Several suites boot the whole app; on a 2-vCPU CI runner with coverage on, that can
    // exceed vitest's 5s default.
    testTimeout: 20_000,
  },
});
