import { describe, expect, it } from 'vitest';

import { checkLocalDbTarget } from '../local-db-guard';

const LOCAL = { DB_DATABASE: 'wmdb', DB_HOST: 'localhost', DB_PASSWORD: 'never-printed', DB_PORT: '5434', DB_USERNAME: 'wm' };
const REMOTE = { ...LOCAL, DB_HOST: 'db.example.com', DB_PORT: '5432' };

function check(env: Record<string, string | undefined>, optIn: boolean) {
  return checkLocalDbTarget({ command: 'migrate:test', env, optIn });
}

describe('checkLocalDbTarget', () => {
  it('lets a writing or dropping command run against a local database', () => {
    expect(check(LOCAL, false)).toMatchObject({ allowed: true, level: 'ok' });
    expect(check({ ...LOCAL, DB_HOST: 'postgres' }, true)).toMatchObject({ allowed: true, level: 'ok' });
  });

  it('never drops a remote database, even with ALLOW_REMOTE_DB=1', () => {
    expect(check(REMOTE, false).allowed).toBe(false);
    expect(check({ ...REMOTE, ALLOW_REMOTE_DB: '1' }, false).allowed).toBe(false);
  });

  it('writes to a remote database only when ALLOW_REMOTE_DB=1 states it, and warns', () => {
    expect(check(REMOTE, true).allowed).toBe(false);
    expect(check({ ...REMOTE, ALLOW_REMOTE_DB: '1' }, true)).toMatchObject({ allowed: true, level: 'warn' });
  });

  it('refuses a target it cannot verify: no DB_HOST, including one given only as DATABASE_URL', () => {
    expect(check({}, true).allowed).toBe(false);
    expect(check({ DATABASE_URL: 'postgres://wm@localhost:5434/wmdb' }, false).allowed).toBe(false);
  });

  it.each([
    ['MIKRO_ORM_HOST', 'db.example.com'],
    ['MIKRO_ORM_CLIENT_URL', 'postgres://wm:secret@db.example.com:5432/wmdb'],
    ['MIKRO_ORM_CLIENT_URL', 'not a url'],
    ['MIKRO_ORM_DB_NAME', 'wm_production'],
  ])('refuses when %s=%s would move the connection off the checked DB_* target', (key, value) => {
    const local = check({ ...LOCAL, [key]: value }, false);
    const statedRemote = check({ ...LOCAL, ALLOW_REMOTE_DB: '1', [key]: value }, true);

    expect(local.allowed).toBe(false);
    expect(local.message).toContain(key);
    expect(statedRemote.allowed).toBe(false);
  });

  it.each([
    ['MIKRO_ORM_HOST', '127.0.0.1'],
    ['MIKRO_ORM_CLIENT_URL', 'postgres://wm@localhost:5434/wmdb'],
    ['MIKRO_ORM_CLIENT_URL', 'postgres://wm@[::1]:5434/wmdb'],
  ])('allows %s=%s, a local host', (key, value) => {
    expect(check({ ...LOCAL, [key]: value }, false).allowed).toBe(true);
  });

  it('never prints the password or a client URL credential', () => {
    const results = [
      check(LOCAL, false),
      check(REMOTE, false),
      check(REMOTE, true),
      check({ ...REMOTE, ALLOW_REMOTE_DB: '1' }, true),
      check({ ...LOCAL, MIKRO_ORM_CLIENT_URL: 'postgres://wm:secret@db.example.com/wmdb' }, false),
    ];

    for (const { message } of results) {
      expect(message).not.toContain('never-printed');
      expect(message).not.toContain('secret');
    }
  });
});
