import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock('@utils/logger', () => ({ default: loggerMock }));

import backfillClient from '../historical-asset-price-backfill-client';

describe('historical-asset-price-backfill-client', () => {
  const send = vi.fn();
  const enqueue = { send, sendAfter: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    send.mockResolvedValue('job-1');
  });

  it('forwards a bounded deadline through the portfolio-singleton queue helper', async () => {
    await backfillClient.trigger({ items: [], portfolioId: 11 }, { enqueue, throwOnFailure: true });

    expect(send).toHaveBeenCalledWith(
      'asset-price.historical-backfill',
      expect.objectContaining({ correlationId: expect.any(String), items: [], portfolioId: 11 }),
      { singletonKey: 'asset-price.historical-backfill:portfolio:11' },
      { timeoutMs: 7_000 },
    );
  });

  it('preserves the queue helper singleton and forwards the optional execution deadline', async () => {
    const { enqueueHistoricalAssetPriceBackfillJob } = await import('@app/jobs/historical-asset-price-backfill.queue');
    await enqueueHistoricalAssetPriceBackfillJob(enqueue, { portfolioId: 12 }, { timeoutMs: 7_000 });

    expect(send).toHaveBeenCalledWith(
      'asset-price.historical-backfill',
      { portfolioId: 12 },
      { singletonKey: 'asset-price.historical-backfill:portfolio:12' },
      { timeoutMs: 7_000 },
    );
  });

  it('swallows and warns on enqueue failure by default', async () => {
    send.mockRejectedValueOnce(new Error('unknown acceptance timeout'));

    await expect(backfillClient.trigger({ items: [], portfolioId: 13 }, { enqueue })).resolves.toBeUndefined();
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.objectContaining({ portfolioId: 13 }), 'Historical asset price backfill enqueue failed');
  });

  it('rethrows enqueue failure when throwOnFailure is requested', async () => {
    const error = new Error('unknown acceptance timeout');
    send.mockRejectedValueOnce(error);

    await expect(backfillClient.trigger({ items: [], portfolioId: 14 }, { enqueue, throwOnFailure: true })).rejects.toBe(error);
    expect(loggerMock.warn).toHaveBeenCalled();
  });
});
