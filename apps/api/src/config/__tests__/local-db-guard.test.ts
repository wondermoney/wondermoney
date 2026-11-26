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

  it('refuses a target it cannot verify: no DB_HOST and no DATABASE_URL', () => {
    expect(check({}, true).allowed).toBe(false);
  });

  describe('with the database given as DATABASE_URL', () => {
    const localUrl = { DATABASE_URL: 'postgres://wm:never-printed@localhost:5434/wmdb' };
    const remoteUrl = { DATABASE_URL: 'postgres://wm:never-printed@db.example.com:5432/wm_production?sslmode=verify-full' };

    it('checks the host the URL names', () => {
      expect(check(localUrl, false)).toMatchObject({ allowed: true, level: 'ok' });
      expect(check(remoteUrl, false).allowed).toBe(false);
      expect(check({ ...remoteUrl, ALLOW_REMOTE_DB: '1' }, false).allowed).toBe(false);
      expect(check(remoteUrl, true).allowed).toBe(false);
      expect(check({ ...remoteUrl, ALLOW_REMOTE_DB: '1' }, true)).toMatchObject({ allowed: true, level: 'warn' });
    });

    it('reports the host and database it checked, never the credentials', () => {
      const { message } = check(remoteUrl, true);

      expect(message).toContain('db.example.com');
      expect(message).toContain('wm_production');
      expect(message).not.toContain('never-printed');
    });

    // The URL names a local host, but `pg` would take these from the query instead.
    it.each([
      ['host', 'remote-db.example.invalid'],
      ['hostaddr', '192.0.2.10'],
      ['port', '6543'],
      ['user', 'postgres'],
      ['password', 'never-printed'],
      ['options', '-c search_path=public'],
    ])('refuses a local-looking DATABASE_URL whose query sets %s, naming it and not its value', (parameter, value) => {
      const url = `postgres://wm:pw@localhost:1/wmdb?${parameter}=${encodeURIComponent(value)}`;

      for (const optIn of [false, true]) {
        const result = check({ ALLOW_REMOTE_DB: '1', DATABASE_URL: url }, optIn);
        expect(result.allowed).toBe(false);
        expect(result.message).toContain(parameter);
        expect(result.message).not.toContain(value);
      }
    });

    it('refuses a MIKRO_ORM_CLIENT_URL whose query moves it off the local host', () => {
      expect(check({ ...LOCAL, MIKRO_ORM_CLIENT_URL: 'postgres://wm@localhost:5434/wmdb?host=remote-db.example.invalid' }, false).allowed).toBe(false);
    });

    it.each([
      ['not a url'],
      ['postgres://wm@localhost:5434'],
      ['postgres:///wmdb?host=/var/run/postgresql'],
      ['wmdb'],
      // pg reads the host of these as %6cocalhost, not localhost.
      ['postgres://u:p@%6cocalhost:1/wmdb#%zz'],
      ['postgres://u:p@%6cocalhost:1/wmdb?application_name=%zz'],
      ['postgres://wm@localhost:5434/wmdb#main'],
    ])('refuses DATABASE_URL=%s, which it cannot check', (value) => {
      expect(check({ DATABASE_URL: value }, true).allowed).toBe(false);
      expect(check({ ALLOW_REMOTE_DB: '1', DATABASE_URL: value }, true).allowed).toBe(false);
    });

    it('refuses DATABASE_URL beside DB_*, even when both name a local database', () => {
      const both = check({ ...LOCAL, ...localUrl }, false);

      expect(both.allowed).toBe(false);
      expect(both.message).toContain('DATABASE_URL and DB_HOST');
      expect(both.message).not.toContain('never-printed');
    });
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
