import http from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { createWorkerHealthServer, resolveWorkerHealthPort } from '@app/worker-health';

const request = (port: number, path: string) => new Promise<{ body: string; statusCode: number }>((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', method: 'GET', path, port }, (res) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    res.on('end', () => {
      resolve({ body: Buffer.concat(chunks).toString('utf8'), statusCode: res.statusCode ?? 0 });
    });
  });
  req.on('error', reject);
  req.end();
});

describe('createWorkerHealthServer', () => {
  let server: ReturnType<typeof createWorkerHealthServer> | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('serves /health and /v1/health', async () => {
    server = createWorkerHealthServer();
    await server.start(0);
    const address = server.server.address();
    if (!address || typeof address === 'string') throw new Error('expected numeric port');

    const health = await request(address.port, '/health');
    const v1Health = await request(address.port, '/v1/health');

    expect(health.statusCode).toBe(200);
    expect(JSON.parse(health.body)).toEqual({ ok: true, service: 'worker' });
    expect(v1Health.statusCode).toBe(200);
    expect(JSON.parse(v1Health.body)).toEqual({ ok: true, service: 'worker' });
  });

  it('reports the injected status and stays 200 while healthy', async () => {
    server = createWorkerHealthServer({ status: () => ({ database: true, ok: true, pgBoss: true }) });
    await server.start(0);
    const address = server.server.address();
    if (!address || typeof address === 'string') throw new Error('expected numeric port');

    const health = await request(address.port, '/health');

    expect(health.statusCode).toBe(200);
    expect(JSON.parse(health.body)).toEqual({ database: true, ok: true, pgBoss: true, service: 'worker' });
  });

  it('returns 503 when the status hook reports unhealthy', async () => {
    // The endpoint used to answer `{ ok: true }` unconditionally, so a worker whose
    // pg-boss client never started — or whose database was unreachable — stayed green
    // forever and nothing restarted it.
    server = createWorkerHealthServer({ status: async () => Promise.resolve({ database: false, ok: false, pgBoss: true }) });
    await server.start(0);
    const address = server.server.address();
    if (!address || typeof address === 'string') throw new Error('expected numeric port');

    const health = await request(address.port, '/health');

    expect(health.statusCode).toBe(503);
    expect(JSON.parse(health.body)).toMatchObject({ database: false, ok: false });
  });

  it('returns 503 rather than hanging when the status hook throws', async () => {
    server = createWorkerHealthServer({ status: () => { throw new Error('pool exhausted'); } });
    await server.start(0);
    const address = server.server.address();
    if (!address || typeof address === 'string') throw new Error('expected numeric port');

    const health = await request(address.port, '/health');

    expect(health.statusCode).toBe(503);
    expect(JSON.parse(health.body)).toMatchObject({ ok: false, reason: 'pool exhausted' });
  });

  it('cannot be told it is healthy by a status object that contradicts the verdict', async () => {
    server = createWorkerHealthServer({ status: () => ({ ok: false }) });
    await server.start(0);
    const address = server.server.address();
    if (!address || typeof address === 'string') throw new Error('expected numeric port');

    const health = await request(address.port, '/health');
    expect((JSON.parse(health.body) as { ok: boolean }).ok).toBe(false);
    expect(health.statusCode).toBe(503);
  });

  it('returns 404 for unknown paths', async () => {
    server = createWorkerHealthServer();
    await server.start(0);
    const address = server.server.address();
    if (!address || typeof address === 'string') throw new Error('expected numeric port');

    const response = await request(address.port, '/nope');

    expect(response.statusCode).toBe(404);
  });
});

describe('resolveWorkerHealthPort', () => {
  it('defaults to 3002 in development even when the API PORT is set', () => {
    expect(resolveWorkerHealthPort({ NODE_ENV: 'development', PORT: '3001' })).toBe(3002);
  });

  it('uses WORKER_HEALTH_PORT when explicitly set', () => {
    expect(resolveWorkerHealthPort({ NODE_ENV: 'production', PORT: '3001', WORKER_HEALTH_PORT: '3100' })).toBe(3100);
  });

  it('uses PORT in production-like environments', () => {
    expect(resolveWorkerHealthPort({ NODE_ENV: 'production', PORT: '3010' })).toBe(3010);
    expect(resolveWorkerHealthPort({ DEPLOY_ENV: 'staging', PORT: '3011' })).toBe(3011);
  });
});
