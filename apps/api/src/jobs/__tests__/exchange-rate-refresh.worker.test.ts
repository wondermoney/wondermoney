import { describe, expect, it, vi } from 'vitest';

import { pgBossJob } from '@app/__tests__/__helpers__/pgboss-job';

import { handleExchangeRateRefreshJob } from '../exchange-rate-refresh.worker';

type Deps = NonNullable<Parameters<typeof handleExchangeRateRefreshJob>[1]>;

function backgroundOperations() {
  return {
    attachQueueJob: vi.fn().mockResolvedValue(true),
    claimJobStart: vi.fn().mockResolvedValue(true),
    createQueuedOperation: vi.fn().mockResolvedValue(undefined),
    finishJob: vi.fn().mockResolvedValue(true),
    heartbeatJob: vi.fn().mockResolvedValue(true),
    markAttemptFailedForRetry: vi.fn().mockResolvedValue(true),
  } as unknown as NonNullable<Deps['backgroundOperationService']>;
}

function recorder() {
  const sent: { payload: unknown; queue: string }[] = [];
  const send = (queue: string, payload: unknown) => {
    sent.push({ payload, queue });
    return Promise.resolve('job-id');
  };
  return { enqueue: { send, sendAfter: send } as unknown as NonNullable<Deps['enqueue']>, sent };
}

describe('exchange-rate refresh job', () => {
  it('asks for a re-conversion pass once new rates are stored', async () => {
    const { enqueue, sent } = recorder();
    const refresh = { refreshExchangeRates: vi.fn().mockResolvedValue({ failed: 0, inserted: 11, mode: 'daily', skipped: 0, totalRows: 11 }) } as unknown as NonNullable<Deps['exchangeRateRefreshService']>;

    await handleExchangeRateRefreshJob(pgBossJob({ correlationId: 'exchange-rate.refresh:run-1' }, { id: 'job-1' }), { backgroundOperationService: backgroundOperations(), enqueue, exchangeRateRefreshService: refresh });

    expect(sent).toEqual([{ payload: { correlationId: 'fx.reconvert:exchange-rate.refresh:run-1' }, queue: 'fx.reconvert' }]);
  });

  it('asks for nothing when the refresh fails', async () => {
    const { enqueue, sent } = recorder();
    const refresh = { refreshExchangeRates: vi.fn().mockRejectedValue(new Error('ECB down')) } as unknown as NonNullable<Deps['exchangeRateRefreshService']>;

    await expect(handleExchangeRateRefreshJob(pgBossJob({ correlationId: 'exchange-rate.refresh:run-2' }, { id: 'job-2' }), { backgroundOperationService: backgroundOperations(), enqueue, exchangeRateRefreshService: refresh })).rejects.toThrow('ECB down');

    expect(sent).toEqual([]);
  });

  it('still succeeds when the follow-up cannot be queued', async () => {
    const enqueue = { send: vi.fn().mockRejectedValue(new Error('queue unavailable')), sendAfter: vi.fn() } as unknown as NonNullable<Deps['enqueue']>;
    const refresh = { refreshExchangeRates: vi.fn().mockResolvedValue({ failed: 0, inserted: 0, mode: 'daily', skipped: 11, totalRows: 11 }) } as unknown as NonNullable<Deps['exchangeRateRefreshService']>;

    await expect(handleExchangeRateRefreshJob(pgBossJob({ correlationId: 'exchange-rate.refresh:run-3' }, { id: 'job-3' }), { backgroundOperationService: backgroundOperations(), enqueue, exchangeRateRefreshService: refresh })).resolves.toBe(true);
  });
});
