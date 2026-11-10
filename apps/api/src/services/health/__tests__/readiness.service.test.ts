import { describe, expect, it, vi } from 'vitest';

import { checkReadiness, type ReadinessDeps } from '@service/health/readiness.service';
import { buildInfo } from '@utils/constants';

const NOW = new Date('2026-11-07T12:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

/**
 * A stand-in for Postgres that answers each of the three probes by what it asks for, so a test
 * states the database's condition ("the heartbeat ran 20 minutes ago") rather than call order.
 */
const fakeDatabase = (overrides: {
  backlog?: () => Promise<unknown>;
  heartbeat?: () => Promise<unknown>;
  ping?: () => Promise<unknown>;
} = {}) => vi.fn((sql: string) => {
  if (/select 1/iu.test(sql)) return (overrides.ping ?? (() => Promise.resolve([{ '?column?': 1 }])))();
  if (/completed_on/iu.test(sql)) return (overrides.heartbeat ?? (() => Promise.resolve([{ last_completed_on: minutesAgo(3) }])))();
  return (overrides.backlog ?? (() => Promise.resolve([])))();
});

const log = () => ({ warn: vi.fn() });

const run = (deps: Partial<ReadinessDeps> = {}) => checkReadiness({
  env: {},
  execute: fakeDatabase(),
  logger: log(),
  now: () => NOW,
  timeoutMs: 50,
  ...deps,
});

const SECRET_DETAIL = 'connect ECONNREFUSED 10.1.2.3:5432 postgres://wondermoney:hunter2@db.internal.example:5432/wondermoney';

describe('readiness', () => {
  it('is ok when the database answers, no queue is backed up and the worker ran its heartbeat recently', async () => {
    const report = await run();

    expect(report.status).toBe('ok');
    expect(report.checks).toEqual({
      database: { status: 'ok' },
      queue: { status: 'ok' },
      worker: { lastHeartbeatAt: minutesAgo(3).toISOString(), status: 'ok' },
    });
  });

  it('reports a database that refuses connections as unreachable', async () => {
    const report = await run({
      execute: fakeDatabase({ ping: () => Promise.reject(new Error(SECRET_DETAIL)) }),
    });

    expect(report.status).toBe('degraded');
    expect(report.checks.database).toEqual({ reason: 'unreachable', status: 'fail' });
  });

  it('gives up on a database that does not answer within the timeout instead of hanging', async () => {
    const never = () => new Promise<unknown>(() => undefined);
    const started = Date.now();

    const report = await run({ execute: fakeDatabase({ backlog: never, heartbeat: never, ping: never }), timeoutMs: 30 });

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(report.status).toBe('degraded');
    expect(report.checks).toEqual({
      database: { reason: 'timeout', status: 'fail' },
      queue: { reason: 'timeout', status: 'fail' },
      worker: { reason: 'timeout', status: 'fail' },
    });
  });

  it('fails the worker check when the heartbeat last ran more than 15 minutes ago', async () => {
    const report = await run({
      execute: fakeDatabase({ heartbeat: () => Promise.resolve([{ last_completed_on: minutesAgo(16) }]) }),
    });

    expect(report.status).toBe('degraded');
    expect(report.checks.worker).toEqual({ lastHeartbeatAt: minutesAgo(16).toISOString(), reason: 'stale_heartbeat', status: 'fail' });
  });

  it('fails the worker check when no heartbeat has ever completed', async () => {
    const report = await run({
      execute: fakeDatabase({ heartbeat: () => Promise.resolve([{ last_completed_on: null }]) }),
    });

    expect(report.checks.worker).toEqual({ lastHeartbeatAt: null, reason: 'no_heartbeat', status: 'fail' });
  });

  it('fails the queue and worker checks when the job tables cannot be read', async () => {
    const missing = () => Promise.reject(new Error('relation "pgboss.job" does not exist'));

    const report = await run({ execute: fakeDatabase({ backlog: missing, heartbeat: missing }) });

    expect(report.checks.database).toEqual({ status: 'ok' });
    expect(report.checks.queue).toEqual({ reason: 'unavailable', status: 'fail' });
    expect(report.checks.worker).toEqual({ reason: 'unavailable', status: 'fail' });
  });

  it('fails the queue check when a job has waited longer than the configured maximum', async () => {
    const backlog = () => Promise.resolve([{ name: 'account.csv-import', oldest_start_after: minutesAgo(61) }]);

    const report = await run({ execute: fakeDatabase({ backlog }) });

    expect(report.status).toBe('degraded');
    expect(report.checks.queue).toEqual({ reason: 'backlog', stalledQueues: 1, status: 'fail' });
  });

  it('honours HEALTH_MAX_JOB_AGE_MINUTES', async () => {
    const backlog = () => Promise.resolve([{ name: 'account.csv-import', oldest_start_after: minutesAgo(20) }]);

    expect((await run({ env: { HEALTH_MAX_JOB_AGE_MINUTES: '15' }, execute: fakeDatabase({ backlog }) })).checks.queue.status).toBe('fail');
    expect((await run({ env: { HEALTH_MAX_JOB_AGE_MINUTES: '30' }, execute: fakeDatabase({ backlog }) })).checks.queue.status).toBe('ok');
  });

  it('lets queues that drain over hours by design wait longer than the default', async () => {
    // Scheduled email batches fan out per user and drain over several hours.
    const backlog = () => Promise.resolve([{ name: 'email.weekly.user', oldest_start_after: minutesAgo(90) }]);

    const report = await run({ execute: fakeDatabase({ backlog }) });

    expect(report.checks.queue).toEqual({ status: 'ok' });
  });

  it('never puts driver messages, hostnames or credentials in the report, and logs them instead', async () => {
    const logger = log();
    const fail = () => Promise.reject(new Error(SECRET_DETAIL));

    const report = await run({ execute: fakeDatabase({ backlog: fail, heartbeat: fail, ping: fail }), logger });

    const body = JSON.stringify(report);
    expect(body).not.toContain('ECONNREFUSED');
    expect(body).not.toContain('10.1.2.3');
    expect(body).not.toContain('hunter2');
    expect(body).not.toContain('db.internal.example');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('reports the build it runs', async () => {
    const report = await run();

    expect(report).toMatchObject(buildInfo());
  });
});
