import { beforeEach, describe, expect, it, vi } from 'vitest';

const { em, eodhd, snapSvc } = vi.hoisted(() => ({
  em: { find: vi.fn(), getKnex: vi.fn(() => ({ ignore: vi.fn().mockResolvedValue(undefined), insert: vi.fn().mockReturnThis(), into: vi.fn().mockReturnThis(), onConflict: vi.fn().mockReturnThis() })) },
  eodhd: { getEndOfDayPrices: vi.fn() },
  snapSvc: { backfillSnapshotsForPortfolio: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@app/database/di', () => ({ DI: { em } }));
vi.mock('@service/market-data/eodhd.service', () => ({ default: eodhd }));
vi.mock('../portfolio-snapshot.service', () => ({ default: snapSvc }));

import service from '../historical-asset-price-backfill.service';

type BackfillInput = Parameters<typeof service.backfillHistoricalAssetPrices>[0];

beforeEach(() => { em.find.mockReset(); eodhd.getEndOfDayPrices.mockReset(); snapSvc.backfillSnapshotsForPortfolio.mockReset(); });

describe('historical asset price backfill service', () => {
  it('skips when coverage exists', async () => {
    em.find.mockResolvedValueOnce([{ date: new Date('2026-05-20T00:00:00Z') }, { date: new Date('2026-05-21T00:00:00Z') }, { date: new Date('2026-05-22T00:00:00Z') }]);
    const result = await service.backfillHistoricalAssetPrices({ items: [{ financialAssetId: 7, symbol: 'AAPL', transactionDate: '2026-05-20' }], portfolioId: 1 } as unknown as BackfillInput, { now: new Date('2026-05-23T12:00:00Z') });
    expect(result.failed).toBe(0);
    expect(eodhd.getEndOfDayPrices).not.toHaveBeenCalled();
  });
  it('fetches inserts and snapshots', async () => {
    em.find.mockResolvedValueOnce([]); eodhd.getEndOfDayPrices.mockResolvedValueOnce([{ close: 100, date: '2026-05-20' }]);
    await service.backfillHistoricalAssetPrices({ items: [{ financialAssetId: 7, symbol: 'AAPL', transactionDate: '2026-05-20' }], portfolioId: 1 } as unknown as BackfillInput, { now: new Date('2026-05-22T12:00:00Z') });
    expect(eodhd.getEndOfDayPrices).toHaveBeenCalledWith('AAPL', { from: '2026-05-20', to: '2026-05-21' });
    expect(snapSvc.backfillSnapshotsForPortfolio).toHaveBeenCalledWith(1, expect.any(Date));
  });
  it('chooses the earliest valid date across item fields and snapshots once', async () => {
    em.find.mockResolvedValue([]);
    eodhd.getEndOfDayPrices.mockResolvedValue([{ close: 100, date: '2026-05-19' }]);

    await service.backfillHistoricalAssetPrices({
      items: [
        { earliestTransactionDate: '2026-05-20', financialAssetId: 7, symbol: 'AAPL', transactionDate: '2026-05-19' },
        { earliestTransactionDate: '2026-05-21', financialAssetId: 8, symbol: 'MSFT', transactionDate: '2026-05-22' },
      ],
      portfolioId: 1,
    } as unknown as BackfillInput, { now: new Date('2026-05-23T12:00:00Z') });

    expect(eodhd.getEndOfDayPrices).toHaveBeenNthCalledWith(1, 'AAPL', { from: '2026-05-19', to: '2026-05-22' });
    expect(eodhd.getEndOfDayPrices).toHaveBeenNthCalledWith(2, 'MSFT', { from: '2026-05-21', to: '2026-05-22' });
    expect(snapSvc.backfillSnapshotsForPortfolio).toHaveBeenCalledTimes(1);
    expect(snapSvc.backfillSnapshotsForPortfolio).toHaveBeenCalledWith(1, new Date('2026-05-19T00:00:00.000Z'));
  });
  it('skips today and future dates without calling eodhd', async () => {
    const result = await service.backfillHistoricalAssetPrices({ items: [{ financialAssetId: 7, symbol: 'AAPL', transactionDate: '2026-05-21' }], portfolioId: 1 } as unknown as BackfillInput, { now: new Date('2026-05-21T12:00:00Z') });
    expect(result.skipped).toBe(1);
    expect(eodhd.getEndOfDayPrices).not.toHaveBeenCalled();
  });
  it('reports per-item failures', async () => {
    em.find.mockRejectedValueOnce(new Error('db down'));
    const result = await service.backfillHistoricalAssetPrices({ items: [{ financialAssetId: 7, symbol: 'AAPL', transactionDate: '2026-05-20' }], portfolioId: 1 } as unknown as BackfillInput);
    expect(result.failed).toBe(1);
    expect(snapSvc.backfillSnapshotsForPortfolio).not.toHaveBeenCalled();
  });
  it('uses knex onConflict ignore for inserts', async () => {
    const ignore = vi.fn().mockResolvedValue(undefined);
    const onConflict = vi.fn().mockReturnValue({ ignore });
    const insert = vi.fn().mockReturnValue({ into: vi.fn().mockReturnValue({ onConflict }) });
    em.getKnex.mockReturnValueOnce({ insert } as unknown as ReturnType<typeof em.getKnex>);
    em.find.mockResolvedValueOnce([]);
    eodhd.getEndOfDayPrices.mockResolvedValueOnce([{ close: 100, date: '2026-05-20' }]);

    await service.backfillHistoricalAssetPrices({ items: [{ financialAssetId: 7, symbol: 'AAPL', transactionDate: '2026-05-20' }], portfolioId: 1 } as unknown as BackfillInput, { now: new Date('2026-05-22T12:00:00Z') });

    expect(onConflict).toHaveBeenCalledWith(['financial_asset_key', 'date']);
    expect(ignore).toHaveBeenCalled();
  });
});
