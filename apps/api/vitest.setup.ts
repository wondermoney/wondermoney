import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// 1. Never let a test read the developer's .env
// ---------------------------------------------------------------------------
// `src/app.ts`, `src/mikro-orm.config.ts`, `src/config/env.ts`, `src/utils/constants.ts` and a
// dozen controllers/services all call `dotenv.config({ quiet: true })` at *import* time. Any
// test that transitively imports one of them would otherwise splice the checked-out `.env` into
// `process.env` for the whole worker — and per CLAUDE.md that `.env` is frequently pointed at
// a PRODUCTION database and carries live third-party API keys.
//
// Two observed consequences before this guard existed:
//   * 6 test files / 31 tests failed locally but passed in CI, purely because real env values
//     were present where the test asserted their absence — green CI, red laptop.
//   * `src/services/__tests__/eodhd.service.test.ts` deleted `EODHD_API_KEY` and expected a
//     throw; with the real key already loaded it instead performed a *live, billable* HTTP call
//     to the EODHD market-data provider.
//
// dotenv 18 also reads `DOTENV_CONFIG_PATH` in programmatic `dotenv.config()` calls, so pointing
// it at /dev/null is a second line of defence; it would not cover a call that passes its own
// `path`. Mock the module as well: every call site uses the default export, and a no-op
// `config()` returns dotenv's own success shape. The mock mirrors dotenv 18's exports.
process.env['DOTENV_CONFIG_PATH'] = '/dev/null';

vi.mock('dotenv', () => {
  const result = { parsed: {} as Record<string, string> };
  const api = {
    config: () => result,
    configDotenv: () => result,
    parse: () => ({}) as Record<string, string>,
    populate: () => undefined,
  };

  return { ...api, default: api };
});

// Vitest reuses a worker process across test files, and `process.env` is process-wide — so a file
// that sets `APP_ENV`/`NODE_ENV`/a feature flag and forgets to clean up silently reconfigures every
// file that runs after it in the same worker. That makes failures depend on file ordering, which
// changes whenever a test file is added or removed. Snapshot the pristine environment on this
// worker's first setup run and restore it before every subsequent file, so each file starts from
// the same environment regardless of what ran before it.
const ENV_BASELINE_KEY = '__wmEnvBaseline__';
const globalScope = globalThis as typeof globalThis & { [ENV_BASELINE_KEY]?: NodeJS.ProcessEnv };
// Deployed environments must name their own addresses (config/instance-urls.ts), and many tests
// simulate production; give every test the same neutral example instance.
const envBaseline = (globalScope[ENV_BASELINE_KEY] ??= {
  API_URL: 'https://api.example.test',
  APP_URL: 'https://app.example.test',
  ...process.env,
});

for (const key of Object.keys(process.env)) {
  if (!(key in envBaseline)) Reflect.deleteProperty(process.env, key);
}
Object.assign(process.env, envBaseline);

// A handful of modules validate env vars at *import* time (better-auth, mikro-orm.config.ts).
// With dotenv neutralised above there is never a .env to fall back on, so any test that
// transitively imports one of them unmocked would throw during collection — and because module
// evaluation order across workers is not fixed, which files hit it is non-deterministic. Seed
// inert placeholders so the import-time guards pass. `??=` never overrides a value explicitly
// exported into the environment, and nothing here opens a connection (MikroORM.init is still
// mocked per test).
process.env.BETTER_AUTH_SECRET ??= 'test-only-better-auth-secret-32-chars-long-placeholder';
process.env.DB_HOST ??= 'localhost';
process.env.DB_PORT ??= '5432';
process.env.DB_DATABASE ??= 'test';
process.env.DB_USERNAME ??= 'test';
process.env.DB_PASSWORD ??= 'test';

// ---------------------------------------------------------------------------
// 2. Fail loudly on any unmocked network access
// ---------------------------------------------------------------------------
// A unit test must never reach the internet: it spends third-party quota, makes the suite
// depend on provider uptime, and hides the fact that a dependency was left unmocked. Replace
// the global `fetch` with a guard that throws a descriptive error naming the URL, so an
// accidental call fails immediately and legibly instead of silently succeeding.
//
// Opting in: a test that genuinely needs `fetch` overrides it as usual —
//   `vi.stubGlobal('fetch', vi.fn())`  (restored to this guard by `vi.unstubAllGlobals()`)
//   `globalThis.fetch = vi.fn()`
//   `vi.spyOn(globalThis, 'fetch').mockResolvedValue(...)`
// This is a plain assignment rather than `vi.stubGlobal` precisely so that a test file calling
// `vi.unstubAllGlobals()` restores the guard instead of the real, network-capable `fetch`.
const blockedFetch: typeof globalThis.fetch = (input, _init) => {
  const url = input instanceof Request ? input.url : String(input);

  return Promise.reject(
    new Error(
      `[vitest] Blocked a real network request to "${url}". ` +
        'Unit tests must not perform HTTP calls — mock the client/service for this test, or ' +
        "opt in explicitly with vi.stubGlobal('fetch', vi.fn()).",
    ),
  );
};

globalThis.fetch = blockedFetch;

