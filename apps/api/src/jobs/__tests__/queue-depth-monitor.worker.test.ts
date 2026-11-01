import { beforeEach, describe, expect, it, vi } from 'vitest';

const { captureMessageMock } = vi.hoisted(() => ({ captureMessageMock: vi.fn() }));
vi.mock('@sentry/node', () => ({ captureMessage: captureMessageMock }));

import {
  backlogThresholdSeconds,
  handleQueueDepthMonitorJob,
  resolvePgBossSchema,
} from '@app/jobs/queue-depth-monitor.worker';

const silentLogger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
const NOW = new Date('2026-09-15T12:00:00.000Z');
const secondsAgo = (seconds: number) => new Date(NOW.getTime() - seconds * 1_000);

const run = (rows: unknown[], extra: { schema?: string } = {}) =>
  handleQueueDepthMonitorJob({
    execute: vi.fn().mockResolvedValue(rows),
    logger: silentLogger,
    now: () => NOW,
    schema: extra.schema ?? 'pgboss',
  });

describe('queue depth monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports nothing when every queue is inside its threshold', async () => {
    const summary = await run([
      { count: 3, name: 'analytics.outbox', oldest_created_on: secondsAgo(30), state: 'created' },
      { count: 120, name: 'transaction.enrichment.gpt', oldest_created_on: secondsAgo(600), state: 'created' },
    ]);

    expect(summary.stalled).toEqual([]);
    expect(summary.totalWaiting).toBe(123);
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it('raises one Sentry event for a queue whose oldest waiting job is past its threshold', async () => {
    // A queue with a hung handler keeps accepting jobs and
    // stops draining. Nothing else in the system notices.
    const summary = await run([
      { count: 42, name: 'account.initial-sync', oldest_created_on: secondsAgo(9_000), state: 'created' },
    ]);

    expect(summary.stalled).toHaveLength(1);
    expect(summary.stalled[0]).toMatchObject({ count: 42, name: 'account.initial-sync', state: 'created' });
    expect(captureMessageMock).toHaveBeenCalledTimes(1);
    const [, options] = captureMessageMock.mock.calls[0] as [string, { extra: Record<string, unknown>; fingerprint: string[]; level: string }];
    expect(options.level).toBe('error');
    // Fingerprinted per queue+state so a queue stuck for hours stays one issue.
    expect(options.fingerprint).toEqual(['queue-backlog', 'account.initial-sync', 'created']);
    expect(options.extra['thresholdSeconds']).toBe(7_200);
  });

  it('applies per-queue thresholds rather than one global number', async () => {
    const summary = await run([
      // 900s is fine for a bank sync and far past the line for a CSV preview.
      { count: 1, name: 'account.initial-sync', oldest_created_on: secondsAgo(900), state: 'created' },
      { count: 1, name: 'portfolio.csv-parse-preview', oldest_created_on: secondsAgo(900), state: 'created' },
    ]);

    expect(summary.stalled.map((entry) => entry.name)).toEqual(['portfolio.csv-parse-preview']);
  });

  it('alerts on any job at all sitting in a dead-letter queue', async () => {
    const summary = await run([
      { count: 1, name: 'transaction.enrichment.gpt.dlq', oldest_created_on: secondsAgo(1), state: 'created' },
    ]);

    expect(summary.stalled).toHaveLength(1);
    expect(backlogThresholdSeconds('transaction.enrichment.gpt.dlq')).toBe(0);
  });

  it('treats an unknown queue with the default threshold', () => {
    expect(backlogThresholdSeconds('some.queue.nobody.registered')).toBe(1_800);
  });

  it('ignores rows with no oldest timestamp instead of treating them as infinitely old', async () => {
    const summary = await run([{ count: 0, name: 'lifecycle.send', oldest_created_on: null, state: 'retry' }]);
    expect(summary.stalled).toEqual([]);
  });

  it('counts retry jobs as a backlog but not active ones (the query excludes them)', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    await handleQueueDepthMonitorJob({ execute, logger: silentLogger, now: () => NOW, schema: 'pgboss' });
    const sql = execute.mock.calls[0]?.[0] as string;
    expect(sql).toContain(`'created'`);
    expect(sql).toContain(`'retry'`);
    expect(sql).not.toContain(`'active'`);
  });

  it('rejects a schema name that is not a bare identifier', () => {
    expect(() => resolvePgBossSchema({ PGBOSS_SCHEMA: 'pgboss"; drop table job; --' })).toThrow('Invalid PGBOSS_SCHEMA');
    expect(resolvePgBossSchema({})).toBe('pgboss');
  });

  it('never lets a Sentry failure take the monitor down', async () => {
    captureMessageMock.mockImplementationOnce(() => { throw new Error('sentry down'); });
    await expect(run([
      { count: 1, name: 'account.initial-sync', oldest_created_on: secondsAgo(9_000), state: 'created' },
    ])).resolves.toMatchObject({ queues: 1 });
  });
});
