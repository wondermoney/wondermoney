import type { Job } from 'pg-boss';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { captureMessageMock } = vi.hoisted(() => ({ captureMessageMock: vi.fn() }));
vi.mock('@sentry/node', () => ({ captureMessage: captureMessageMock }));

import { deadLetterQueueName, ensureDeadLetterQueue, handleDeadLetterJob } from '@app/jobs/dead-letter';

const silentLogger = { error: vi.fn() };

describe('dead-letter queues', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('names a dead-letter queue after its origin', () => {
    expect(deadLetterQueueName('lifecycle.send')).toBe('lifecycle.send.dlq');
  });

  it('creates the dead-letter queue with no retries and long retention', async () => {
    const createQueue = vi.fn().mockResolvedValue(undefined);
    await ensureDeadLetterQueue({ createQueue }, 'lifecycle.send');

    expect(createQueue).toHaveBeenCalledWith('lifecycle.send.dlq', expect.objectContaining({
      // Retrying is what exhausted the original job; doing it again here is pointless.
      retryLimit: 0,
    }));
    const [, options] = createQueue.mock.calls[0] as [string, { retentionSeconds: number }];
    // Evidence has to survive a weekend.
    expect(options.retentionSeconds).toBeGreaterThanOrEqual(2_592_000);
  });

  it('raises one Sentry event carrying the ORIGIN queue, not the dlq name', async () => {
    await handleDeadLetterJob('lifecycle.send', { data: { appuserKey: 4, campaign: 'trial' }, id: 'job-9' } as Job<unknown>, { logger: silentLogger });

    expect(captureMessageMock).toHaveBeenCalledTimes(1);
    const [message, options] = captureMessageMock.mock.calls[0] as [string, { extra: Record<string, unknown>; fingerprint: string[]; level: string; tags: Record<string, string> }];
    expect(message).toContain('lifecycle.send');
    expect(options.level).toBe('error');
    expect(options.tags['queue']).toBe('lifecycle.send');
    expect(options.fingerprint).toEqual(['pgboss-dead-letter', 'lifecycle.send']);
    expect(options.extra['deadLetterQueue']).toBe('lifecycle.send.dlq');
    expect(options.extra['payloadKeys']).toEqual(['appuserKey', 'campaign']);
  });

  it('never rethrows — a job that dead-letters out of a dead-letter queue has nowhere to go', async () => {
    captureMessageMock.mockImplementationOnce(() => { throw new Error('sentry down'); });
    await expect(handleDeadLetterJob('lifecycle.send', { data: {}, id: 'job-9' } as Job<unknown>, { logger: silentLogger }))
      .resolves.toBeUndefined();
  });
});
