import type { Job } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { handlePortfolioSnapshotAutoJob } from '@app/jobs/portfolio-snapshot.worker';
import { Portfolio } from '@entity/Portfolio';

type SnapshotService = NonNullable<NonNullable<Parameters<typeof handlePortfolioSnapshotAutoJob>[1]>['portfolioSnapshotService']>;

const operations = () => ({
  attachQueueJob: vi.fn().mockResolvedValue(true),
  claimJobStart: vi.fn().mockResolvedValue(true),
  createQueuedOperation: vi.fn().mockResolvedValue(true),
  finishJob: vi.fn().mockResolvedValue(true),
  heartbeatJob: vi.fn().mockResolvedValue(true),
});

describe('the nightly portfolio snapshot sweep', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);

  it('records a portfolio excluded from the aggregate dashboard too, so its own chart has no gap', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const portfolio = (name: string, excluded: boolean) => em.create(Portfolio, { currencyKey: household.currency, excluded, name, portfolioOwnerAppuserKey: household.appuser, tenantKey: household.tenant }, { partial: true });
    const counted = portfolio('Counted', false);
    const excluded = portfolio('Excluded', true);
    const deleted = portfolio('Deleted', false);
    deleted.deletedAt = new Date();
    await em.flush();
    const snapshots = { backfillSnapshotsForPortfolio: vi.fn(), updateSnapshotForToday: vi.fn().mockResolvedValue(undefined) };

    await handlePortfolioSnapshotAutoJob({ data: {}, id: 'job-1' } as Job<{ cursor?: number }>, {
      backgroundOperationService: operations(),
      portfolioSnapshotService: snapshots as unknown as SnapshotService,
    });

    const recorded = snapshots.updateSnapshotForToday.mock.calls.map(([key]) => key as number).toSorted((a, b) => a - b);
    expect(recorded).toEqual([counted.portfolioKey, excluded.portfolioKey]);
  });
});
