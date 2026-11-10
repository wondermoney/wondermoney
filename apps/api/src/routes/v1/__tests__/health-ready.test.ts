import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock('@app/app', () => ({
  DI: { em: { getConnection: () => ({ execute: executeMock, isConnected: () => Promise.resolve(true) }) } },
}));

vi.mock('@utils/logger', () => ({
  default: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const mountHealth = async () => {
  // A fresh module per test: the router caches its last answer for a few seconds.
  vi.resetModules();
  const { default: healthRoutes } = await import('@route/health');
  const app = express();
  app.use('/v1/health', healthRoutes);
  return app;
};

const healthyDatabase = (sql: string) => {
  if (/select 1/iu.test(sql)) return Promise.resolve([{ '?column?': 1 }]);
  if (/completed_on/iu.test(sql)) return Promise.resolve([{ last_completed_on: new Date() }]);
  return Promise.resolve([]);
};

describe('GET /v1/health/ready', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it('answers 200 with every check ok on a healthy stack, and is never cached', async () => {
    executeMock.mockImplementation(healthyDatabase);

    const response = await request(await mountHealth()).get('/v1/health/ready');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      checks: { database: { status: 'ok' }, queue: { status: 'ok' }, worker: { status: 'ok' } },
      status: 'ok',
      version: expect.any(String),
    });
    expect(response.body).toHaveProperty('commit');
  });

  it('answers 503 without leaking the driver error when Postgres is down', async () => {
    executeMock.mockRejectedValue(new Error('connect ECONNREFUSED 10.1.2.3:5432 password=hunter2'));

    const response = await request(await mountHealth()).get('/v1/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('degraded');
    expect(response.body.checks.database).toEqual({ reason: 'unreachable', status: 'fail' });
    expect(response.text).not.toContain('ECONNREFUSED');
    expect(response.text).not.toContain('10.1.2.3');
    expect(response.text).not.toContain('hunter2');
  });

  it('keeps the liveness check independent of the database', async () => {
    executeMock.mockRejectedValue(new Error('down'));

    const response = await request(await mountHealth()).get('/v1/health');

    expect(response.status).toBe(200);
  });
});
