import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { databaseUrlProblem, parseDatabaseUrl } from '../database-target';

describe('parseDatabaseUrl', () => {
  it('reads the host, port and database of a postgres URL', () => {
    expect(parseDatabaseUrl('postgres://wm:pw@db.example.com:6432/wondermoney?sslmode=verify-full&application_name=wm'))
      .toEqual({ database: 'wondermoney', host: 'db.example.com', port: 6432, username: 'wm' });
    expect(parseDatabaseUrl('postgresql://wm@[::1]/wm%20db')).toEqual({ database: 'wm db', host: '::1', port: null, username: 'wm' });
  });

  it('accepts a TLS file parameter naming a file pg can read, and refuses one it cannot', () => {
    // Any readable file will do: `parse` only loads it, as `pg` does when it connects.
    const readable = fileURLToPath(new URL('fixtures/precedence.env', import.meta.url));

    expect(parseDatabaseUrl(`postgres://wm@db.example.com/wondermoney?sslmode=verify-full&sslrootcert=${readable}`))
      .toMatchObject({ host: 'db.example.com' });
    expect(databaseUrlProblem({ DATABASE_URL: 'postgres://wm@db.example.com/wondermoney?sslrootcert=/nonexistent/ca.pem' })?.message)
      .toMatch(/TLS file/);
  });

  // `pg` parses the string exactly as given. A stray `%` anywhere makes it re-encode the whole URL,
  // so `%6cocalhost` stays `%6cocalhost` for `pg` while a cleaned-up copy would read `localhost`.
  it.each([
    ['in a fragment', 'postgres://u:p@%6cocalhost:1/wmdb#%zz'],
    ['in a query value', 'postgres://u:p@%6cocalhost:1/wmdb?application_name=%zz'],
  ])('refuses a URL that pg would read differently because of a stray %% %s', (_where, url) => {
    expect(parseDatabaseUrl(url)).toBeNull();
    expect(databaseUrlProblem({ DATABASE_URL: url })?.code).toBe('invalid-format');
  });

  it('refuses any # and says how to write one in a password', () => {
    expect(parseDatabaseUrl('postgres://wm:pw@db.example.com/wondermoney#main')).toBeNull();
    expect(databaseUrlProblem({ DATABASE_URL: 'postgres://wm:p#w@db.example.com/wondermoney' })?.message).toMatch(/%23/);
    expect(parseDatabaseUrl('postgres://wm:p%23w@db.example.com/wondermoney')).toMatchObject({ host: 'db.example.com' });
  });

  it.each([
    ['not a url'],
    ['mysql://wm@db.example.com/wondermoney'],
    ['https://db.example.com/wondermoney'],
    ['postgres://wm@db.example.com'],
    ['postgres://wm@db.example.com/'],
    ['postgres:///wondermoney?host=/var/run/postgresql'],
  ])('does not accept %s', (value) => {
    expect(parseDatabaseUrl(value)).toBeNull();
  });
});

// `pg` lets these query parameters replace the URL's own host, port, credentials or server options
// (better-auth's search_path), so the target the guard checks would not be the one used.
describe.each([
  ['host', 'remote-db.example.invalid'],
  ['hostaddr', '192.0.2.10'],
  ['port', '6543'],
  ['user', 'postgres'],
  ['password', 'never-printed'],
  ['options', '-c search_path=public'],
])('a DATABASE_URL whose query sets %s', (parameter, value) => {
  const url = `postgres://wm:pw@localhost:5434/wmdb?sslmode=disable&${parameter}=${encodeURIComponent(value)}`;

  it('is refused, naming the parameter and never its value', () => {
    const problem = databaseUrlProblem({ DATABASE_URL: url });

    expect(parseDatabaseUrl(url)).toBeNull();
    expect(problem?.code).toBe('invalid-format');
    expect(problem?.message).toContain(parameter);
    expect(problem?.message).not.toContain(value);
  });

  it('is refused however the name is written', () => {
    const encoded = Array.from(parameter, (char) => `%${char.charCodeAt(0).toString(16)}`).join('');

    expect(parseDatabaseUrl(`postgres://wm@localhost/wmdb?${encoded}=${encodeURIComponent(value)}`)).toBeNull();
    expect(parseDatabaseUrl(`postgres://wm@localhost/wmdb?${parameter.toUpperCase()}=${encodeURIComponent(value)}`)).toBeNull();
  });
});

describe('databaseUrlProblem', () => {
  it('accepts DATABASE_URL alone, and no DATABASE_URL at all', () => {
    expect(databaseUrlProblem({ DATABASE_URL: 'postgres://wm:pw@db.example.com/wondermoney' })).toBeNull();
    expect(databaseUrlProblem({ DB_HOST: 'localhost' })).toBeNull();
    // docker compose passes `DATABASE_URL=` through as an empty string: unset.
    expect(databaseUrlProblem({ DATABASE_URL: '  ', DB_HOST: 'localhost' })).toBeNull();
  });

  it('refuses DATABASE_URL beside any DB_* setting, naming them', () => {
    const problem = databaseUrlProblem({ DATABASE_URL: 'postgres://wm@db.example.com/wondermoney', DB_HOST: 'localhost', DB_PASSWORD: 'pw' });

    expect(problem?.code).toBe('conflict');
    expect(problem?.message).toMatch(/DB_HOST, DB_PASSWORD/);
  });

  it('refuses a malformed DATABASE_URL without repeating it, since it carries the password', () => {
    const problem = databaseUrlProblem({ DATABASE_URL: 'postgres://wm:hunter2@db.example.com' });

    expect(problem?.code).toBe('invalid-format');
    expect(problem?.message).not.toContain('hunter2');
  });
});
