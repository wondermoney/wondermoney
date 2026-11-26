import { describe, expect, it } from 'vitest';

import { databaseUrlProblem, parseDatabaseUrl } from '../database-target';

describe('parseDatabaseUrl', () => {
  it('reads the host, port and database of a postgres URL', () => {
    expect(parseDatabaseUrl('postgres://wm:pw@db.example.com:6432/wondermoney?sslmode=require'))
      .toEqual({ database: 'wondermoney', host: 'db.example.com', port: 6432 });
    expect(parseDatabaseUrl('postgresql://wm@[::1]/wm%20db')).toEqual({ database: 'wm db', host: '::1', port: null });
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
