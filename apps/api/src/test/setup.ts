import { vi } from 'vitest';

/**
 * Global vitest setup.
 *
 * Registers the shared better-auth test double (src/services/auth/__mocks__/better-auth.ts)
 * for every test file. The real module (services/auth/better-auth.ts) fails fast at import
 * when `BETTER_AUTH_SECRET` / the `DB_*` env is missing — by design, so a misconfigured
 * prod/staging deploy can't boot — and additionally builds a live pg `Pool` and imports the
 * email service. In the unit-test harness none of that exists, which crashed any test that
 * (even transitively) imported the app, server, or worker before it could run.
 *
 * A single global mock here replaces all the previous per-file workarounds. Tests that need
 * bespoke behaviour can still declare their own `vi.mock('@service/auth/better-auth', ...)`
 * (it takes precedence for that file), and the module's own unit test opts back into the
 * real implementation with `vi.unmock`.
 */
vi.mock('@service/auth/better-auth');
