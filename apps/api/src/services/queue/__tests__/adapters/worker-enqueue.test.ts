import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWorkerEnqueueAdapter } from '@service/queue/enqueue';

const loggerMock = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }));
vi.mock('@utils/logger', () => ({ default: loggerMock }));

describe('WorkerEnqueueAdapter', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });
  it('maps send through to boss.send with its options', async () => {
    const boss = { send: vi.fn().mockResolvedValue('job-1') };
    const enqueue = createWorkerEnqueueAdapter(boss);

    await expect(
      enqueue.send('foundation.health-check', { correlationId: 'corr-1' }, { singletonKey: 'corr-1' }),
    ).resolves.toBe('job-1');

    expect(boss.send).toHaveBeenCalledWith('foundation.health-check', { correlationId: 'corr-1' }, { singletonKey: 'corr-1' });
  });

  it('maps sendAfter through to boss.sendAfter with options and the schedule date', async () => {
    const boss = { sendAfter: vi.fn().mockResolvedValue('job-2') };
    const enqueue = createWorkerEnqueueAdapter(boss);
    const scheduledFor = new Date('2026-01-15T09:00:00.000Z');

    await expect(
      enqueue.sendAfter('portfolio.csv-parse-preview', { importSessionId: 7 }, { retryLimit: 3 }, scheduledFor),
    ).resolves.toBe('job-2');

    expect(boss.sendAfter).toHaveBeenCalledWith(
      'portfolio.csv-parse-preview',
      { importSessionId: 7 },
      { retryLimit: 3 },
      scheduledFor,
    );
  });

  it('passes null options to sendAfter when none are given', async () => {
    const boss = { sendAfter: vi.fn().mockResolvedValue(null) };
    const enqueue = createWorkerEnqueueAdapter(boss);
    const scheduledFor = new Date('2026-01-15T09:00:00.000Z');

    await enqueue.sendAfter('portfolio.csv-import-confirmed', { importSessionId: 7 }, undefined, scheduledFor);

    expect(boss.sendAfter).toHaveBeenCalledWith(
      'portfolio.csv-import-confirmed',
      { importSessionId: 7 },
      null,
      scheduledFor,
    );
  });

  it('rejects payloads pg-boss cannot accept', async () => {
    const boss = { send: vi.fn().mockResolvedValue('job-3') };
    const enqueue = createWorkerEnqueueAdapter(boss);

    await expect(enqueue.send('foundation.health-check', 'not job data')).rejects.toThrow(
      'job payload must be an object or null',
    );
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('uses the borrowed worker client without starting or stopping its lifecycle', async () => {
    const lifecycle = { start: vi.fn(), stop: vi.fn() };
    const boss = {
      ...lifecycle,
      send: vi.fn().mockResolvedValue('job-4'),
    };
    const enqueue = createWorkerEnqueueAdapter(boss);

    await enqueue.send('foundation.health-check', { correlationId: 'corr-4' });

    expect(boss.send).toHaveBeenCalled();
    expect(lifecycle.start).not.toHaveBeenCalled();
    expect(lifecycle.stop).not.toHaveBeenCalled();
  });

  it('applies caller timeout without stopping borrowed client and observes late work', async () => {
    vi.useFakeTimers();
    const warn = loggerMock.warn;
    let rejectSend!: (error: Error) => void;
    const lifecycle = { cancel: vi.fn(), close: vi.fn(), start: vi.fn(), stop: vi.fn() };
    const boss = { ...lifecycle, send: vi.fn(() => new Promise((_resolve, reject) => { rejectSend = reject; })) };
    const enqueue = createWorkerEnqueueAdapter(boss);
    const pending = enqueue.send('foundation.health-check', {}, undefined, { timeoutMs: 10 });
    const rejected = pending.then(() => undefined, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(await rejected).toMatchObject({ name: 'EnqueueTimeoutError' });
    expect(vi.getTimerCount()).toBe(0);
    rejectSend(new Error('late rejection'));
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledOnce();
    expect(lifecycle.start).not.toHaveBeenCalled();
    expect(lifecycle.stop).not.toHaveBeenCalled();
    expect(lifecycle.close).not.toHaveBeenCalled();
    expect(lifecycle.cancel).not.toHaveBeenCalled();
  });

  it('clears the deadline timer when send is accepted before the deadline', async () => {
    vi.useFakeTimers();
    const boss = { send: vi.fn().mockResolvedValue('job-5') };
    const enqueue = createWorkerEnqueueAdapter(boss);

    await expect(enqueue.send('foundation.health-check', { correlationId: 'corr-5' }, undefined, { timeoutMs: 100 })).resolves.toBe('job-5');

    expect(boss.send).toHaveBeenCalledWith('foundation.health-check', { correlationId: 'corr-5' }, undefined);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not report an ordinary pre-deadline send failure as late work', async () => {
    const warn = loggerMock.warn;
    const sendFailure = new Error('send failed');
    const enqueue = createWorkerEnqueueAdapter({ send: vi.fn().mockRejectedValue(sendFailure) });
    await expect(enqueue.send('foundation.health-check', {}, undefined, { timeoutMs: 100 })).rejects.toBe(sendFailure);
    expect(warn).not.toHaveBeenCalled();
  });

  it('forwards sendAfter options/date and clears the deadline after acceptance', async () => {
    vi.useFakeTimers();
    const boss = { sendAfter: vi.fn().mockResolvedValue('scheduled') };
    const enqueue = createWorkerEnqueueAdapter(boss);
    const scheduledFor = new Date('2026-02-01T12:00:00.000Z');
    await expect(enqueue.sendAfter('portfolio.csv-import-confirmed', { importSessionId: 7 }, { retryLimit: 4 }, scheduledFor, { timeoutMs: 100 })).resolves.toBe('scheduled');
    expect(boss.sendAfter).toHaveBeenCalledWith('portfolio.csv-import-confirmed', { importSessionId: 7 }, { retryLimit: 4 }, scheduledFor);
    expect(vi.getTimerCount()).toBe(0);
  });
});
