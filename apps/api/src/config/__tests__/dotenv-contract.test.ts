import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

// vitest.setup.ts mocks `dotenv` for every test so nothing reads the developer's .env. This file
// loads the real module against a fixture, to pin what `readProcessSource()` in configuration.ts
// relies on when it calls `dotenv.config({ quiet: true })` at boot.
const { default: dotenv } = await vi.importActual<{ default: typeof import('dotenv') }>('dotenv');

const fixture = fileURLToPath(new URL('./fixtures/precedence.env', import.meta.url));

describe('dotenv as the API loads it', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('never lets the .env file replace a value the deployment already set', () => {
    const processEnv: Record<string, string> = { DB_HOST: 'from-deployment' };

    dotenv.config({ path: fixture, processEnv, quiet: true });

    expect(processEnv['DB_HOST']).toBe('from-deployment');
    expect(processEnv['ONLY_IN_FILE']).toBe('loaded');
  });

  it('stays silent with quiet: true even when the environment asks for logging', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubEnv('DOTENV_QUIET', 'false');

    dotenv.config({ path: fixture, processEnv: {}, quiet: true });

    expect(stderr).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
  });
});
