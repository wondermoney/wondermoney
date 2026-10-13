import { describe, expect, it, vi } from 'vitest';

import { enqueueFoundationJob, ensureFoundationQueue, FOUNDATION_QUEUE_OPTIONS } from '@app/jobs/queue';

describe('enqueueFoundationJob', () => {
  it('sends the foundation queue payload with correlation options through the enqueue seam', async () => {
    const enqueue = { send: vi.fn().mockResolvedValue('job-1'), sendAfter: vi.fn() };

    await enqueueFoundationJob(
      {
        correlationId: 'corr-123',
        payload: { source: 'test' },
      },
      { enqueue } as unknown as Parameters<typeof enqueueFoundationJob>[1],
    );

    expect(enqueue.send).toHaveBeenCalledWith(
      'foundation.health-check',
      { correlationId: 'corr-123', source: 'test' },
      { singletonKey: 'corr-123' },
    );
  });

  it('creates the foundation queue with idempotent options', async () => {
    const boss = { createQueue: vi.fn().mockResolvedValue(undefined) };
    await ensureFoundationQueue(boss as unknown as Parameters<typeof ensureFoundationQueue>[0]);
    expect(boss.createQueue).toHaveBeenCalledWith('foundation.health-check', FOUNDATION_QUEUE_OPTIONS);
  });
});
