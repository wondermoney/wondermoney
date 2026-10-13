import { beforeEach, describe, expect, it, vi } from 'vitest';

const historicalBackfillClient = vi.hoisted(() => ({ trigger: vi.fn() }));
const portfolioSnapshotService = vi.hoisted(() => ({ backfillSnapshotsForPortfolio: vi.fn() }));

vi.mock('../historical-asset-price-backfill-client', () => ({
  default: historicalBackfillClient,
}));

vi.mock('../portfolio-snapshot.service', () => ({
  default: portfolioSnapshotService,
}));

import service from '../portfolio-import-maintenance.service';

type ExpireDeps = NonNullable<Parameters<typeof service.expireStaleSessions>[0]>;
type MaintenanceEm = ExpireDeps['em'];

describe('portfolio import maintenance service', () => {
  const enqueue = { send: vi.fn(), sendAfter: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    historicalBackfillClient.trigger.mockResolvedValue(undefined);
    portfolioSnapshotService.backfillSnapshotsForPortfolio.mockResolvedValue(undefined);
  });

  it('triggers historical backfill with earliest buy date for each portfolio asset', async () => {
    const raw = vi.fn().mockResolvedValue({
      rows: [
        { earliest_buy_date: new Date('2019-11-21T09:05:00.000Z'), financial_asset_key: 7, symbol: 'IWDA.AS' },
        { earliest_buy_date: '2024-01-01T00:00:00.000Z', financial_asset_key: 2, symbol: 'AAPL' },
      ],
    });
    const em = { getKnex: () => ({ raw }) };

    await service.triggerPostImportMaintenance({ earliestTransactionDate: new Date('2026-01-02T00:00:00.000Z'), portfolioId: 34 }, { em: em as unknown as MaintenanceEm, enqueue });

    expect(historicalBackfillClient.trigger).toHaveBeenCalledWith({
      items: [
        { earliestTransactionDate: '2019-11-21', financialAssetId: 7, symbol: 'IWDA.AS' },
        { earliestTransactionDate: '2024-01-01', financialAssetId: 2, symbol: 'AAPL' },
      ],
      portfolioId: 34,
    }, { enqueue, throwOnFailure: true });
    expect(portfolioSnapshotService.backfillSnapshotsForPortfolio).not.toHaveBeenCalled();
  });

  it('propagates historical backfill enqueue failures so imports can record maintenance errors', async () => {
    const raw = vi.fn().mockResolvedValue({
      rows: [{ earliest_buy_date: new Date('2019-11-21T09:05:00.000Z'), financial_asset_key: 7, symbol: 'IWDA.AS' }],
    });
    const em = { getKnex: () => ({ raw }) };
    historicalBackfillClient.trigger.mockRejectedValueOnce(new Error('pgboss unavailable'));

    await expect(service.triggerPostImportMaintenance({ portfolioId: 34 }, { em: em as unknown as MaintenanceEm, enqueue })).rejects.toThrow('pgboss unavailable');
  });

  it('rebuilds snapshots directly when imported rows do not add buy assets', async () => {
    const raw = vi.fn().mockResolvedValue({ rows: [] });
    const em = { getKnex: () => ({ raw }) };
    const earliestTransactionDate = new Date('2026-01-02T00:00:00.000Z');

    await service.triggerPostImportMaintenance({ earliestTransactionDate, portfolioId: 35 }, { em: em as unknown as MaintenanceEm, enqueue });

    expect(historicalBackfillClient.trigger).not.toHaveBeenCalled();
    expect(portfolioSnapshotService.backfillSnapshotsForPortfolio).toHaveBeenCalledWith(35, earliestTransactionDate);
  });

  it('expires stale non-terminal sessions and removes uploaded objects', async () => {
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    const em = {
      find: vi.fn().mockResolvedValue([
        { createdAt: new Date('2020-01-01T00:00:00.000Z'), expiresAt: null, portfolioImportSessionKey: 1, s3Bucket: 'bucket', s3Key: 'key.csv', status: 'uploaded' },
      ]),
      flush: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn().mockImplementation(() => em),
    };

    const count = await service.expireStaleSessions({ em: em as unknown as MaintenanceEm, s3Service: { deleteObject } as unknown as ExpireDeps['s3Service'] });

    expect(count).toBe(1);
    expect(deleteObject).toHaveBeenCalledWith('bucket', 'key.csv');
    expect(em.persist).toHaveBeenCalled();
  });

  it('persists expiry before deleting uploaded objects', async () => {
    const order: string[] = [];
    const deleteObject = vi.fn().mockImplementation(() => { order.push('delete'); return Promise.resolve(); });
    const em = {
      find: vi.fn().mockResolvedValue([
        { createdAt: new Date('2020-01-01T00:00:00.000Z'), expiresAt: null, portfolioImportSessionKey: 1, s3Bucket: 'bucket', s3Key: 'key.csv', status: 'uploaded' },
      ]),
      flush: vi.fn().mockImplementation(() => { order.push('persist'); return Promise.resolve(); }),
      persist: vi.fn().mockImplementation(() => em),
    };

    await service.expireStaleSessions({ em: em as unknown as MaintenanceEm, s3Service: { deleteObject } as unknown as ExpireDeps['s3Service'] });

    expect(order).toEqual(['persist', 'delete']);
  });
});
