import type { Job } from 'pg-boss';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMock } = vi.hoisted(() => ({ findMock: vi.fn() }));
vi.mock('@app/database/di', () => ({ DI: { em: { find: findMock } } }));

import { PORTFOLIO_SNAPSHOT_AUTO_QUEUE } from '@app/jobs/portfolio-snapshot.queue';
import { handlePortfolioSnapshotAutoJob } from '@app/jobs/portfolio-snapshot.worker';

type SnapshotService = NonNullable<NonNullable<Parameters<typeof handlePortfolioSnapshotAutoJob>[1]>['portfolioSnapshotService']>;

const bg = () => ({
  attachQueueJob: vi.fn().mockResolvedValue(true),
  claimJobStart: vi.fn().mockResolvedValue(true),
  createQueuedOperation: vi.fn().mockResolvedValue(true),
  finishJob: vi.fn().mockResolvedValue(true),
  heartbeatJob: vi.fn().mockResolvedValue(true),
});

const portfolios = (keys: number[]) => keys.map((portfolioKey) => ({ portfolioKey }));

describe('portfolio snapshot auto job', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('pages with a cursor instead of loading every portfolio', async () => {
    // The sweep used to be `em.find(Portfolio, {...})` with no limit and no cursor, then a
    // serial loop inside one 900s job at `retryLimit: 0` — so past some portfolio count
    // the job expired mid-run and every portfolio after that point permanently lost that
    // day's snapshot (snapshots are date-keyed; tomorrow does not backfill).
    findMock.mockResolvedValue(portfolios([11, 12]));
    const snapshots = { backfillSnapshotsForPortfolio: vi.fn(), updateSnapshotForToday: vi.fn().mockResolvedValue(undefined) };

    await handlePortfolioSnapshotAutoJob({ data: { cursor: 10 }, id: 'job-1' } as Job<{ cursor?: number }>, {
      backgroundOperationService: bg(),
      pageSize: 2,
      portfolioSnapshotService: snapshots as unknown as SnapshotService,
    });

    const [, where, options] = findMock.mock.calls[0] as [unknown, Record<string, unknown>, Record<string, unknown>];
    expect(where['portfolioKey']).toEqual({ $gt: 10 });
    expect(options['limit']).toBe(2);
    expect(options['orderBy']).toEqual({ portfolioKey: 'asc' });
  });

  it('chains a continuation job when the page is full', async () => {
    findMock.mockResolvedValue(portfolios([1, 2]));
    const send = vi.fn().mockResolvedValue('next-job');
    const snapshots = { backfillSnapshotsForPortfolio: vi.fn(), updateSnapshotForToday: vi.fn().mockResolvedValue(undefined) };

    await handlePortfolioSnapshotAutoJob({ data: {}, id: 'job-1' } as Job<{ cursor?: number }>, {
      backgroundOperationService: bg(),
      boss: { send },
      pageSize: 2,
      portfolioSnapshotService: snapshots as unknown as SnapshotService,
    });

    expect(send).toHaveBeenCalledWith(
      PORTFOLIO_SNAPSHOT_AUTO_QUEUE,
      expect.objectContaining({ cursor: 2 }),
      expect.objectContaining({ singletonKey: 'portfolio.snapshot.auto:cursor:2' }),
    );
  });

  it('does not chain when the page is short — that is the end of the sweep', async () => {
    findMock.mockResolvedValue(portfolios([1]));
    const send = vi.fn();
    const snapshots = { backfillSnapshotsForPortfolio: vi.fn(), updateSnapshotForToday: vi.fn().mockResolvedValue(undefined) };

    await handlePortfolioSnapshotAutoJob({ data: {}, id: 'job-1' } as Job<{ cursor?: number }>, {
      backgroundOperationService: bg(),
      boss: { send },
      pageSize: 5,
      portfolioSnapshotService: snapshots as unknown as SnapshotService,
    });

    expect(send).not.toHaveBeenCalled();
  });

  it('batches the heartbeat instead of writing one row per portfolio', async () => {
    findMock.mockResolvedValue(portfolios(Array.from({ length: 30 }, (_, index) => index + 1)));
    const operations = bg();
    const snapshots = { backfillSnapshotsForPortfolio: vi.fn(), updateSnapshotForToday: vi.fn().mockResolvedValue(undefined) };

    await handlePortfolioSnapshotAutoJob({ data: {}, id: 'job-1' } as Job<{ cursor?: number }>, {
      backgroundOperationService: operations,
      pageSize: 30,
      portfolioSnapshotService: snapshots as unknown as SnapshotService,
    });

    expect(snapshots.updateSnapshotForToday).toHaveBeenCalledTimes(30);
    // One at the 25-portfolio mark plus one page-completion heartbeat — not 30.
    expect(operations.heartbeatJob).toHaveBeenCalledTimes(2);
  });

  it('ignores a malformed cursor rather than skipping the whole sweep', async () => {
    findMock.mockResolvedValue([]);
    await handlePortfolioSnapshotAutoJob({ data: { cursor: -5 }, id: 'job-1' } as unknown as Job<{ cursor?: number }>, {
      backgroundOperationService: bg(),
      portfolioSnapshotService: { backfillSnapshotsForPortfolio: vi.fn(), updateSnapshotForToday: vi.fn() } as unknown as SnapshotService,
    });

    const [, where] = findMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(where['portfolioKey']).toEqual({ $gt: 0 });
  });
});
