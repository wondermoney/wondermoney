import { describe, expect, it } from 'vitest';

import { databaseUrlProblem, parseDatabaseUrl } from '../database-target';

describe('parseDatabaseUrl', () => {
  it('reads the host, port and database of a postgres URL', () => {
    expect(parseDatabaseUrl('postgres://wm:pw@db.example.com:6432/wondermoney?sslmode=verify-full&application_name=wm'))
      .toEqual({ database: 'wondermoney', host: 'db.example.com', port: 6432, username: 'wm' });
    expect(parseDatabaseUrl('postgresql://wm@[::1]/wm%20db')).toEqual({ database: 'wm db', host: '::1', port: null, username: 'wm' });
  });

  it('reads a TLS file parameter without opening the file', () => {
    expect(parseDatabaseUrl('postgres://wm@db.example.com/wondermoney?sslmode=verify-full&sslrootcert=/nonexistent/ca.pem'))
      .toMatchObject({ host: 'db.example.com' });
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
