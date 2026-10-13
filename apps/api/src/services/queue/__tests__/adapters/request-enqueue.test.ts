import '@app/jobs/queue';
import '@app/jobs/portfolio-csv-import-confirmed.queue';
import '@app/jobs/portfolio-csv-parse-preview.queue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRequestEnqueueAdapter } from '@service/queue/enqueue';
import type { OwnedProducerBoss, OwnedProducerRuntime } from '@service/queue/owned-producer-runtime';

interface RuntimeOverrides {
  boss?: Partial<OwnedProducerBoss>;
  dispose?: OwnedProducerRuntime['dispose'];
  start?: OwnedProducerRuntime['start'];
}

/** Reads the underlying mock off a fixture object without separating the typed method from its `this`. */
const getMock = (target: object, method: string): unknown => Object.getOwnPropertyDescriptor(target, method)?.value;

const makeRuntime = (overrides: RuntimeOverrides = {}) => {
  const events: string[] = [];
  const boss: OwnedProducerBoss = {
    createQueue: vi.fn(() => { events.push('ensure'); return Promise.resolve(); }),
    findJobs: vi.fn(),
    send: vi.fn(() => { events.push('send'); return Promise.resolve('job-1'); }),
    sendAfter: vi.fn(() => { events.push('sendAfter'); return Promise.resolve('job-2'); }),
    updateQueue: vi.fn(() => Promise.resolve()),
    ...overrides.boss,
  };
  const runtime: OwnedProducerRuntime = {
    boss,
    dispose: overrides.dispose ?? vi.fn(() => { events.push('dispose'); return Promise.resolve(); }),
    start: overrides.start ?? vi.fn(() => { events.push('start'); return Promise.resolve(); }),
  };
  return { events, runtime };
};

afterEach(() => vi.useRealTimers());

describe('RequestEnqueueAdapter', () => {
  it('constructs a fresh runtime per send and runs startup, ensure, send, disposal', async () => {
    const { events, runtime } = makeRuntime();
    const createRuntime = vi.fn(() => runtime);
    const enqueue = createRequestEnqueueAdapter({ createRuntime });
    await expect(enqueue.send('foundation.health-check', { correlationId: 'c1' }, { singletonKey: 'c1' })).resolves.toBe('job-1');
    expect(events).toEqual(['start', 'ensure', 'send', 'dispose']);
    expect(getMock(runtime.boss, 'send')).toHaveBeenCalledWith('foundation.health-check', { correlationId: 'c1' }, { singletonKey: 'c1' });
    expect(createRuntime).toHaveBeenCalledOnce();
    expect(getMock(runtime, 'dispose')).toHaveBeenCalledOnce();
  });

  it('does not construct a runtime for invalid timeout values', async () => {
    const createRuntime = vi.fn();
    const enqueue = createRequestEnqueueAdapter({ createRuntime });
    await expect(enqueue.send('foundation.health-check', {}, undefined, { timeoutMs: 0 })).rejects.toThrow('finite positive');
    await expect(enqueue.send('foundation.health-check', {}, undefined, { timeoutMs: Infinity })).rejects.toThrow('finite positive');
    expect(createRuntime).not.toHaveBeenCalled();
  });

  it('disposes on startup failure without masking the primary error', async () => {
    const failure = new Error('start failed');
    const { runtime } = makeRuntime({ dispose: vi.fn().mockRejectedValue(new Error('cleanup failed')), start: vi.fn().mockRejectedValue(failure) });
    const enqueue = createRequestEnqueueAdapter({ createRuntime: () => runtime });
    await expect(enqueue.send('foundation.health-check', {})).rejects.toBe(failure);
    expect(getMock(runtime, 'dispose')).toHaveBeenCalledOnce();
  });

  it('preserves send errors when disposal also fails', async () => {
    const sendFailure = new Error('send failed');
    const { runtime } = makeRuntime({
      boss: { send: vi.fn().mockRejectedValue(sendFailure) },
      dispose: vi.fn().mockRejectedValue(new Error('cleanup failed')),
    });
    const enqueue = createRequestEnqueueAdapter({ createRuntime: () => runtime });
    await expect(enqueue.send('foundation.health-check', {})).rejects.toBe(sendFailure);
    expect(getMock(runtime, 'dispose')).toHaveBeenCalledOnce();
  });

  it('keeps accepted result when asynchronous cleanup rejects', async () => {
    const { runtime } = makeRuntime({ dispose: vi.fn().mockRejectedValue(new Error('cleanup failed')) });
    const enqueue = createRequestEnqueueAdapter({ createRuntime: () => runtime });
    await expect(enqueue.send('foundation.health-check', {})).resolves.toBe('job-1');
    await Promise.resolve();
    expect(getMock(runtime, 'dispose')).toHaveBeenCalledOnce();
  });

  it('retries queue ensure after a failure and caches only successful ensures', async () => {
    const { runtime } = makeRuntime({ boss: { createQueue: vi.fn().mockRejectedValueOnce(new Error('ensure failed')).mockResolvedValue(undefined) } });
    const enqueue = createRequestEnqueueAdapter({ createRuntime: () => runtime });
    await expect(enqueue.send('foundation.health-check', {})).rejects.toThrow('ensure failed');
    await expect(enqueue.send('foundation.health-check', {})).resolves.toBe('job-1');
    await expect(enqueue.send('foundation.health-check', {})).resolves.toBe('job-1');
    expect(getMock(runtime.boss, 'createQueue')).toHaveBeenCalledTimes(2);
  });

  it('rejects on deadline, initiates disposal immediately, and observes late operation settlement', async () => {
    vi.useFakeTimers();
    let rejectSend!: (error: Error) => void;
    const { runtime } = makeRuntime({ boss: { send: vi.fn(() => new Promise<string>((_resolve, reject) => { rejectSend = reject; })) } });
    const enqueue = createRequestEnqueueAdapter({ createRuntime: () => runtime });
    const pending = enqueue.send('foundation.health-check', {}, undefined, { timeoutMs: 25 });
    const rejected = pending.then(() => undefined, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(25);
    expect(await rejected).toMatchObject({ name: 'EnqueueTimeoutError' });
    expect(getMock(runtime, 'dispose')).toHaveBeenCalledOnce();
    rejectSend(new Error('late send rejection'));
    await Promise.resolve();
    await Promise.resolve();
    expect(getMock(runtime.boss, 'send')).toHaveBeenCalledOnce();
  });

  it('expires stalled startup without waiting for cleanup or running later phases', async () => {
    vi.useFakeTimers();
    let resolveStart!: () => void;
    const { events, runtime } = makeRuntime({
      dispose: vi.fn(() => new Promise<void>(() => undefined)),
      start: vi.fn(() => new Promise<void>((resolve) => { resolveStart = resolve; })),
    });
    const enqueue = createRequestEnqueueAdapter({ createRuntime: () => runtime });
    const pending = enqueue.send('foundation.health-check', {}, undefined, { timeoutMs: 15 });
    const result = pending.then(() => undefined, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15);
    expect(await result).toMatchObject({ name: 'EnqueueTimeoutError' });
    expect(getMock(runtime, 'dispose')).toHaveBeenCalledOnce();
    resolveStart();
    await Promise.resolve();
    await Promise.resolve();
    expect(getMock(runtime.boss, 'createQueue')).not.toHaveBeenCalled();
    expect(getMock(runtime.boss, 'send')).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('does not cache a queue ensure that settles after its deadline', async () => {
    vi.useFakeTimers();
    let resolveEnsure!: () => void;
    const stalled = makeRuntime({ boss: { createQueue: vi.fn(() => new Promise<void>((resolve) => { resolveEnsure = resolve; })) } });
    const next = makeRuntime();
    const runtimes = [stalled.runtime, next.runtime];
    let runtimeIndex = 0;
    const createRuntime = vi.fn(() => {
      const runtime = runtimes[runtimeIndex];
      runtimeIndex += 1;
      if (!runtime) throw new Error('No runtime fixture available');
      return runtime;
    });
    const enqueue = createRequestEnqueueAdapter({ createRuntime });
    const pending = enqueue.send('foundation.health-check', {}, undefined, { timeoutMs: 20 });
    const result = pending.then(() => undefined, (error: unknown) => error);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toMatchObject({ name: 'EnqueueTimeoutError' });
    resolveEnsure();
    await Promise.resolve();
    await Promise.resolve();
    expect(getMock(stalled.runtime.boss, 'send')).not.toHaveBeenCalled();

    await expect(enqueue.send('foundation.health-check', {})).resolves.toBe('job-1');
    expect(getMock(next.runtime.boss, 'createQueue')).toHaveBeenCalledOnce();
    expect(getMock(stalled.runtime, 'dispose')).toHaveBeenCalledOnce();
  });

  it('isolates concurrent invocation runtimes and deadlines', async () => {
    vi.useFakeTimers();
    const first = makeRuntime({ boss: { send: vi.fn(() => new Promise<string>(() => undefined)) } });
    const second = makeRuntime({ boss: { send: vi.fn().mockResolvedValue('accepted') } });
    const runtimes = [first.runtime, second.runtime];
    let runtimeIndex = 0;
    const createRuntime = vi.fn(() => {
      const runtime = runtimes[runtimeIndex];
      runtimeIndex += 1;
      if (!runtime) throw new Error('No runtime fixture available');
      return runtime;
    });
    const enqueue = createRequestEnqueueAdapter({ createRuntime });
    const timedOut = enqueue.send('foundation.health-check', {}, undefined, { timeoutMs: 10 });
    const accepted = enqueue.send('portfolio.csv-import-confirmed', {}, undefined, { timeoutMs: 100 });
    await expect(accepted).resolves.toBe('accepted');
    expect(getMock(second.runtime, 'dispose')).toHaveBeenCalledOnce();
    const timedOutResult = timedOut.then(() => undefined, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(await timedOutResult).toMatchObject({ name: 'EnqueueTimeoutError' });
    expect(getMock(first.runtime, 'dispose')).toHaveBeenCalledOnce();
    expect(createRuntime).toHaveBeenCalledTimes(2);
  });

  it('forwards sendAfter options/date and clears a winning deadline timer', async () => {
    vi.useFakeTimers();
    const { runtime } = makeRuntime();
    const enqueue = createRequestEnqueueAdapter({ createRuntime: () => runtime });
    const scheduledFor = new Date('2026-02-01T12:00:00.000Z');
    await expect(enqueue.sendAfter('portfolio.csv-import-confirmed', { importSessionId: 7 }, { retryLimit: 3 }, scheduledFor, { timeoutMs: 500 })).resolves.toBe('job-2');
    expect(getMock(runtime.boss, 'sendAfter')).toHaveBeenCalledWith('portfolio.csv-import-confirmed', { importSessionId: 7 }, { retryLimit: 3 }, scheduledFor);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects scalar request payloads before pg-boss send', async () => {
    const { runtime } = makeRuntime();
    const enqueue = createRequestEnqueueAdapter({ createRuntime: () => runtime });
    await expect(enqueue.send('foundation.health-check', 'not job data')).rejects.toThrow('payload must be an object or null');
    expect(getMock(runtime.boss, 'send')).not.toHaveBeenCalled();
    expect(getMock(runtime, 'dispose')).toHaveBeenCalledOnce();
  });

  it('does not block an accepted result on cleanup and does not forward execution options', async () => {
    vi.useFakeTimers();
    const { runtime } = makeRuntime({ dispose: vi.fn(() => new Promise<void>(() => undefined)) });
    const enqueue = createRequestEnqueueAdapter({ createRuntime: () => runtime });
    await expect(enqueue.send('foundation.health-check', {}, { retryLimit: 2 }, { timeoutMs: 1000 })).resolves.toBe('job-1');
    expect(getMock(runtime.boss, 'send')).toHaveBeenCalledWith('foundation.health-check', {}, { retryLimit: 2 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
