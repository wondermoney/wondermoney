import { describe, expect, it } from 'vitest';

import { buildPgBossConfig } from '@app/jobs/pgboss.config';

describe('buildPgBossConfig', () => {
  it('requires the database env vars', () => {
    expect(() =>
      buildPgBossConfig({
        DB_DATABASE: 'wmdb',
        DB_HOST: 'localhost',
        DB_PASSWORD: 'secret',
        DB_PORT: '5432',
      }),
    ).toThrow(/DB_HOST|DB_PORT|DB_DATABASE|DB_USERNAME|DB_PASSWORD/);
  });

  it('validates the connection string inputs and encodes credentials', () => {
    const config = buildPgBossConfig({
      DB_DATABASE: 'wm db',
      DB_HOST: 'db.internal',
      DB_PASSWORD: 'pa:ss@word',
      DB_PORT: '5433',
      DB_USERNAME: 'wm user',
      NODE_ENV: 'development',
    });

    expect(config.connectionString).toBe('postgres://wm%20user:pa%3Ass%40word@db.internal:5433/wm%20db');
    expect(config.schema).toBe('pgboss');
  });

  it('rejects invalid port values and boolean strings', () => {
    expect(() =>
      buildPgBossConfig({
        DB_DATABASE: 'wmdb',
        DB_HOST: 'localhost',
        DB_PASSWORD: 'secret',
        DB_PORT: 'not-a-number',
        DB_USERNAME: 'wmuser',
      }),
    ).toThrow(/DB_PORT/);

    expect(() =>
      buildPgBossConfig({
        DB_DATABASE: 'wmdb',
        DB_HOST: 'localhost',
        DB_PASSWORD: 'secret',
        DB_PORT: '5432',
        DB_USERNAME: 'wmuser',
        PGBOSS_SCHEDULE: 'maybe',
      }),
    ).toThrow(/PGBOSS_SCHEDULE/);
  });

  it('uses a conservative migrate default in production unless explicitly enabled', () => {
    const config = buildPgBossConfig({
      DB_DATABASE: 'wmdb',
      DB_HOST: 'localhost',
      DB_PASSWORD: 'secret',
      DB_PORT: '5432',
      DB_USERNAME: 'wmuser',
      NODE_ENV: 'production',
    });

    expect(config.migrate).toBe(false);

    expect(
      buildPgBossConfig({
        DB_DATABASE: 'wmdb',
        DB_HOST: 'localhost',
        DB_PASSWORD: 'secret',
        DB_PORT: '5432',
        DB_USERNAME: 'wmuser',
        NODE_ENV: 'production',
        PGBOSS_MIGRATE: 'true',
      }).migrate,
    ).toBe(true);
  });

  it('defaults schedule ownership off unless explicitly enabled', () => {
    const config = buildPgBossConfig({
      DB_DATABASE: 'wmdb',
      DB_HOST: 'localhost',
      DB_PASSWORD: 'secret',
      DB_PORT: '5432',
      DB_USERNAME: 'wmuser',
    });

    expect(config.schedule).toBe(false);
    expect(buildPgBossConfig({
      DB_DATABASE: 'wmdb',
      DB_HOST: 'localhost',
      DB_PASSWORD: 'secret',
      DB_PORT: '5432',
      DB_USERNAME: 'wmuser',
      PGBOSS_SCHEDULE: 'true',
    }).schedule).toBe(true);
  });
});
