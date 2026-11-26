import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadDotenv } from '../load-dotenv';

// vitest.setup.ts mocks `dotenv` for every test so nothing reads the developer's .env. This file
// loads the real module, against a fixture, because the precedence below is what decides which
// database a `migrate:*` script connects to.
vi.unmock('dotenv');

const fixture = fileURLToPath(new URL('./fixtures/precedence.env', import.meta.url));

describe('loadDotenv', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('never lets the .env file replace a value the process environment already set', () => {
    const processEnv: Record<string, string> = { DB_HOST: 'from-deployment' };

    loadDotenv({ path: fixture, processEnv });

    expect(processEnv['DB_HOST']).toBe('from-deployment');
    expect(processEnv['ONLY_IN_FILE']).toBe('loaded');
  });

  it('keeps the process environment first even when DOTENV_CONFIG_OVERRIDE asks otherwise', () => {
    vi.stubEnv('DOTENV_CONFIG_OVERRIDE', 'true');
    const processEnv: Record<string, string> = { DB_HOST: 'from-deployment' };

    loadDotenv({ path: fixture, processEnv });

    expect(processEnv['DB_HOST']).toBe('from-deployment');
  });

  it('takes the last assignment when .env sets a key twice', () => {
    const processEnv: Record<string, string> = {};

    loadDotenv({ path: fixture, processEnv });

    expect(processEnv['DB_PORT']).toBe('2222');
  });

  it('fills process.env when no target is given', () => {
    vi.stubEnv('ONLY_IN_FILE', undefined);

    loadDotenv({ path: fixture });

    expect(process.env['ONLY_IN_FILE']).toBe('loaded');
  });

  it('leaves the environment alone when there is no .env file', () => {
    const processEnv: Record<string, string> = { DB_HOST: 'from-deployment' };

    expect(() => { loadDotenv({ path: fileURLToPath(new URL('./fixtures/absent.env', import.meta.url)), processEnv }); }).not.toThrow();
    expect(processEnv).toEqual({ DB_HOST: 'from-deployment' });
  });

  it('stays silent even when the environment asks dotenv to log', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubEnv('DOTENV_CONFIG_QUIET', 'false');

    loadDotenv({ path: fixture, processEnv: {} });

    expect(stderr).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
  });
});
