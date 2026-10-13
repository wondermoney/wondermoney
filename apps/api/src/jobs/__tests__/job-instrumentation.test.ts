import { beforeEach, describe, expect, it, vi } from 'vitest';

const { captureExceptionMock } = vi.hoisted(() => ({ captureExceptionMock: vi.fn() }));
vi.mock('@sentry/node', () => ({ captureException: captureExceptionMock }));

import { instrumentedBatch, payloadKeys } from '@app/jobs/job-instrumentation';

const job = (overrides: Record<string, unknown> = {}) => ({
  data: { appuserKey: 42, correlationId: 'corr-1', emailAddress: 'someone@example.com', tenantKey: 7 },
  id: 'job-1',
  ...overrides,
});

describe('instrumentedBatch', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('runs every job in the batch and reports success', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const result = await instrumentedBatch('some.queue', run)([job({ id: 'a' }), job({ id: 'b' })]);

    expect(run).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true });
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('captures a handler rejection to Sentry AND rethrows, so pg-boss still retries', async () => {
    const error = new Error('handler exploded');
    await expect(instrumentedBatch('some.queue', () => Promise.reject(error))([job()])).rejects.toThrow('handler exploded');
    expect(captureExceptionMock).toHaveBeenCalledWith(error, expect.anything());
  });

  it('never sends the payload — only its key names and correlation handles', async () => {
    await expect(instrumentedBatch('some.queue', () => Promise.reject(new Error('boom')))([
      job({ retryCount: 2 }),
    ])).rejects.toThrow();

    const [, options] = captureExceptionMock.mock.calls[0] as [unknown, { extra: Record<string, unknown>; fingerprint: string[]; tags: Record<string, string> }];
    expect(options.extra['payloadKeys']).toEqual(['appuserKey', 'correlationId', 'emailAddress', 'tenantKey']);
    // The value behind `emailAddress` must never leave the process.
    expect(JSON.stringify(options)).not.toContain('someone@example.com');
    expect(options.tags).toMatchObject({ correlationId: 'corr-1', jobId: 'job-1', queue: 'some.queue', retryCount: '2', tenantKey: '7' });
    // Grouped per queue, so "this queue is failing" is one issue, not one per throw site.
    expect(options.fingerprint).toEqual(['pgboss-handler', 'some.queue']);
  });

  it('stops the batch at the first failure rather than losing the error', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('first failed'))
      .mockResolvedValue(undefined);
    await expect(instrumentedBatch('some.queue', run)([job({ id: 'a' }), job({ id: 'b' })])).rejects.toThrow('first failed');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('still rethrows when Sentry itself throws', async () => {
    captureExceptionMock.mockImplementationOnce(() => { throw new Error('sentry down'); });
    await expect(instrumentedBatch('some.queue', () => Promise.reject(new Error('boom')))([job()]))
      .rejects.toThrow('boom');
  });

  it('tolerates a non-object payload', () => {
    expect(payloadKeys(undefined)).toEqual([]);
    expect(payloadKeys('a string')).toEqual([]);
    expect(payloadKeys([1, 2, 3])).toEqual([]);
  });
});
