import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const eodhdMocks = vi.hoisted(() => ({
  getSplits: vi.fn(),
}));

vi.mock('@app/app', () => ({ DI: { em: {} } }));
vi.mock('@service/market-data/eodhd.service', () => ({ default: { getSplits: eodhdMocks.getSplits } }));
vi.mock('@utils/logger', () => ({ default: { warn: vi.fn() } }));
vi.mock('../portfolio-snapshot.service', () => ({
  default: {
    backfillSnapshotsForPortfolio: vi.fn(),
  },
}));

import { kyselyDouble } from '@app/__tests__/__helpers__/kysely-double';
import { DI } from '@app/app';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialAssetStockAdjustment } from '@entity/FinancialAssetStockAdjustment';
import logger from '@utils/logger';

import portfolioSnapshotService from '../portfolio-snapshot.service';
import { syncStockSplitsForAsset, syncStockSplitsForSymbol } from '../stock-split-sync.service';

const loggerMock = logger as unknown as { warn: ReturnType<typeof vi.fn> };
const snapshotServiceMock = portfolioSnapshotService as unknown as { backfillSnapshotsForPortfolio: ReturnType<typeof vi.fn> };
const mockedGetSplits = eodhdMocks.getSplits;

describe('stock split sync service', () => {
  const asset = { financialAssetKey: 7, symbol: 'AAPL' } as FinancialAsset;
  type AssetRef = Pick<FinancialAsset, 'financialAssetKey' | 'symbol'>;

  function setupEm(existingRows: FinancialAssetStockAdjustment[] = [], options?: { flushRejectsOnce?: boolean; portfolioRows?: { earliest_transaction_date: Date | string; portfolio_key: number }[] }) {
    const findOneMock = vi.fn().mockImplementation((entity, filter): FinancialAsset | FinancialAssetStockAdjustment | null => {
      if (entity === FinancialAsset) return asset;
      if (entity === FinancialAssetStockAdjustment) {
        const criteria = filter as Record<string, unknown> | undefined;
        return existingRows.find((row) => {
          if (criteria?.['name'] != null && row.name === criteria['name']) return true;
          if (criteria?.['splitRatio'] != null && row.splitRatio === criteria['splitRatio']) return true;
          if (criteria?.['numerator'] != null && row.numerator === criteria['numerator'] && row.denominator === criteria['denominator']) return true;
          return false;
        }) ?? null;
      }
      return null;
    });
    const findOneOrFailMock = vi.fn().mockImplementation((entity, filter) => {
      const result = findOneMock(entity, filter);
      if (!result) throw new Error('not found');
      return result as FinancialAsset | FinancialAssetStockAdjustment;
    });
    const findMock = vi.fn().mockImplementation((entity) => {
      if (entity === FinancialAssetStockAdjustment) return existingRows;
      return [];
    });
    const createMock = vi.fn().mockImplementation((Entity, data) => {
      const record = Object.assign(new Entity(), data) as FinancialAssetStockAdjustment;
      existingRows.push(record);
      return record;
    });
    const flushMock = options?.flushRejectsOnce
      ? vi.fn().mockRejectedValueOnce(new UniqueConstraintViolationException(new Error('unique'))).mockResolvedValue(undefined)
      : vi.fn().mockResolvedValue(undefined);
    const clearMock = vi.fn();
    const getReferenceMock = vi.fn().mockImplementation((_Entity, key): AssetRef => {
      if (typeof key === 'number') return { financialAssetKey: key, symbol: 'AAPL' };
      if (key && typeof key === 'object' && 'financialAssetKey' in key) return key as AssetRef;
      return { financialAssetKey: 7, symbol: 'AAPL' };
    });
    const portfolioRows = options?.portfolioRows ?? [];
    const getKyselyMock = vi.fn(() => kyselyDouble(() => portfolioRows).db);
    const forkMock = vi.fn().mockReturnValue({ clear: clearMock, create: createMock, find: findMock, findOne: findOneMock, findOneOrFail: findOneOrFailMock, flush: flushMock, getKysely: getKyselyMock, getReference: getReferenceMock });

    Object.assign(DI.em, { clear: clearMock, create: createMock, find: findMock, findOne: findOneMock, findOneOrFail: findOneOrFailMock, flush: flushMock, fork: forkMock, getKysely: getKyselyMock });

    return { clearMock, createMock, findMock, findOneMock, findOneOrFailMock, flushMock, forkMock, getKyselyMock, getReferenceMock };
  }

  beforeEach(() => {
    snapshotServiceMock.backfillSnapshotsForPortfolio.mockReset();
    loggerMock.warn.mockReset();
    mockedGetSplits.mockReset();
  });

  it('inserts one split row from EODHD payload', async () => {
    const { createMock, forkMock, getReferenceMock } = setupEm();
    mockedGetSplits.mockResolvedValue([{ date: '2026-05-20', split: '4/1' }]);

    const result = await syncStockSplitsForAsset(asset);

    expect(result).toEqual({ inserted: 1 });
    expect(createMock).toHaveBeenCalledWith(
      FinancialAssetStockAdjustment,
      expect.objectContaining({
        adjustmentType: 'SPLIT',
        date: new Date('2026-05-20'),
        denominator: 1,
        financialAssetKey: asset,
        name: 'AAPL-2026-05-20-4:1',
        numerator: 4,
        source: 'EODHD',
        sourceLabel: '4/1',
        splitRatio: 4,
      }),
    );
    expect(mockedGetSplits).toHaveBeenCalledWith('AAPL');
    expect(forkMock).toHaveBeenCalled();
    expect(getReferenceMock).toHaveBeenCalledWith(FinancialAsset, 7);
  });

  it('inserts a split adjustment parsed from EODHD split ratio strings', async () => {
    setupEm();
    mockedGetSplits.mockResolvedValue([{ date: '2020-08-28', split: '4/1' }]);

    const result = await syncStockSplitsForAsset(asset);

    expect(result.inserted).toBe(1);
  });

  it('skips a malformed split ratio string without throwing', async () => {
    setupEm();
    mockedGetSplits.mockResolvedValue([{ date: '2020-08-28', split: 'not-a-ratio' }]);

    const result = await syncStockSplitsForAsset(asset);

    expect(result.inserted).toBe(0);
  });

  it('does not duplicate rows on second sync', async () => {
    setupEm();
    mockedGetSplits.mockResolvedValue([{ date: '2026-05-20', split: '4/1' }]);

    await expect(syncStockSplitsForSymbol('AAPL')).resolves.toEqual({ inserted: 1 });
    await expect(syncStockSplitsForSymbol('AAPL')).resolves.toEqual({ inserted: 0 });
  });

  it('ignores invalid rows', async () => {
    setupEm();
    mockedGetSplits.mockResolvedValue([
      { date: '2026-05-20', split: '4/1' },
      { date: '2026-05-21', split: '0/1' },
      { date: '2026-05-22', split: '4/0' },
      { date: '2026-05-23', split: 'infinity/1' },
      { date: '2026-05-24', split: 'not-a-number/4' },
      { date: '2026-05-25', split: 'garbage' },
    ]);

    await expect(syncStockSplitsForSymbol('AAPL')).resolves.toEqual({ inserted: 1 });
  });

  it('skips future split rows', async () => {
    setupEm();
    const futureYear = new Date().getUTCFullYear() + 1;
    mockedGetSplits.mockResolvedValue([{ date: `${futureYear}-01-01`, split: '2/1' }]);

    await expect(syncStockSplitsForAsset(asset)).resolves.toEqual({ inserted: 0 });
  });

  it('returns zero when EODHD returns no splits', async () => {
    setupEm();
    mockedGetSplits.mockResolvedValue([]);

    await expect(syncStockSplitsForSymbol('AAPL')).resolves.toEqual({ inserted: 0 });
    expect(mockedGetSplits).toHaveBeenCalledWith('AAPL');
  });

  it('propagates errors from the EODHD client', async () => {
    setupEm();
    mockedGetSplits.mockRejectedValue(new Error('EODHD split request failed'));

    await expect(syncStockSplitsForSymbol('AAPL')).rejects.toThrow('EODHD split request failed');
  });

  it('skips duplicates and handles unique violations defensively', async () => {
    const existing = Object.assign(new FinancialAssetStockAdjustment(), {
      adjustmentType: 'SPLIT',
      date: new Date('2026-05-20'),
      denominator: 1,
      financialAssetKey: asset,
      name: 'AAPL-2026-05-20-4:1',
      numerator: 4,
    });
    const { clearMock } = setupEm([existing]);
    mockedGetSplits.mockResolvedValue([{ date: '2026-05-20', split: '4/1' }]);

    await expect(syncStockSplitsForAsset(asset)).resolves.toEqual({ inserted: 0 });
    expect(loggerMock.warn).not.toHaveBeenCalledWith(expect.stringContaining('unique'));
    expect(clearMock).not.toHaveBeenCalled();
  });

  it('skips legacy splitRatio-only duplicate rows', async () => {
    const existing = Object.assign(new FinancialAssetStockAdjustment(), {
      adjustmentType: 'SPLIT',
      date: new Date('2026-05-20'),
      financialAssetKey: asset,
      name: 'legacy-aapl-split',
      splitRatio: 4,
    });
    setupEm([existing]);
    mockedGetSplits.mockResolvedValue([{ date: '2026-05-20', split: '4/1' }]);

    await expect(syncStockSplitsForAsset(asset)).resolves.toEqual({ inserted: 0 });
  });

  it('dedupes legacy splitRatio-only rows on same calendar day with non-midnight timestamp', async () => {
    const existing = Object.assign(new FinancialAssetStockAdjustment(), {
      adjustmentType: 'SPLIT',
      date: new Date('2026-05-20T13:37:00Z'),
      financialAssetKey: asset,
      name: 'legacy-aapl-split',
      splitRatio: 4,
    });
    setupEm([existing]);
    mockedGetSplits.mockResolvedValue([{ date: '2026-05-20', split: '4/1' }]);

    await expect(syncStockSplitsForAsset(asset)).resolves.toEqual({ inserted: 0 });
  });

  it('dedupes reverse split rows with ratio tolerance', async () => {
    const existing = Object.assign(new FinancialAssetStockAdjustment(), {
      adjustmentType: 'SPLIT',
      date: new Date('2026-05-20'),
      financialAssetKey: asset,
      name: 'legacy-aapl-reverse-split',
      splitRatio: 0.33333333333333337,
    });
    setupEm([existing]);
    mockedGetSplits.mockResolvedValue([{ date: '2026-05-20', split: '1/3' }]);

    await expect(syncStockSplitsForAsset(asset)).resolves.toEqual({ inserted: 0 });
  });

  it('restores matching soft-deleted split rows and counts them as inserted', async () => {
    const existing = Object.assign(new FinancialAssetStockAdjustment(), {
      adjustmentType: 'SPLIT',
      date: new Date('2026-05-20T09:15:00Z'),
      deletedAt: new Date('2026-05-21T00:00:00Z'),
      denominator: 1,
      financialAssetKey: asset,
      name: 'AAPL-2026-05-20-4:1-old',
      numerator: 4,
      splitRatio: 4,
    });
    const { flushMock } = setupEm([existing]);
    mockedGetSplits.mockResolvedValue([{ date: '2026-05-20', split: '4/1' }]);

    await expect(syncStockSplitsForAsset(asset)).resolves.toEqual({ inserted: 1 });
    expect(existing.deletedAt).toBeUndefined();
    expect(existing.name).toBe('AAPL-2026-05-20-4:1');
    expect(existing.source).toBe('EODHD');
    expect(flushMock).toHaveBeenCalled();
    expect(snapshotServiceMock.backfillSnapshotsForPortfolio).not.toHaveBeenCalled();
  });

  it('skips insert when generated name already exists', async () => {
    const existing = Object.assign(new FinancialAssetStockAdjustment(), {
      adjustmentType: 'SPLIT',
      date: new Date('2026-05-20'),
      denominator: 1,
      financialAssetKey: asset,
      name: 'AAPL-2026-05-20-4:1',
      numerator: 4,
    });
    setupEm([existing]);
    mockedGetSplits.mockResolvedValue([{ date: '2026-05-20', split: '4/1' }]);

    await expect(syncStockSplitsForAsset(asset)).resolves.toEqual({ inserted: 0 });
  });

  it('recovers from unique violation on flush without counting duplicate insert', async () => {
    const { clearMock, forkMock, getReferenceMock } = setupEm([], { flushRejectsOnce: true });
    mockedGetSplits.mockResolvedValue([
      { date: '2026-05-20', split: '4/1' },
      { date: '2026-05-21', split: '2/1' },
    ]);

    await expect(syncStockSplitsForAsset(asset)).resolves.toEqual({ inserted: 1 });
    expect(clearMock).toHaveBeenCalledTimes(1);
    expect(forkMock).toHaveBeenCalled();
    expect(getReferenceMock.mock.calls.filter(([entity, key]) => entity === FinancialAsset && key === 7).length).toBeGreaterThanOrEqual(2);
  });

  it('refreshes snapshots for affected portfolios after inserting splits', async () => {
    const { getKyselyMock } = setupEm([], { portfolioRows: [{ earliest_transaction_date: '2026-05-18', portfolio_key: 11 }] });
    mockedGetSplits.mockResolvedValue([{ date: '2026-05-20', split: '4/1' }]);

    await expect(syncStockSplitsForAsset(asset)).resolves.toEqual({ inserted: 1 });
    expect(getKyselyMock).toHaveBeenCalled();
    expect(snapshotServiceMock.backfillSnapshotsForPortfolio).toHaveBeenCalledWith(11, new Date('2026-05-18'));
  });

  it('does not refresh snapshots when no split rows are inserted', async () => {
    setupEm();
    mockedGetSplits.mockResolvedValue([]);

    await expect(syncStockSplitsForAsset(asset)).resolves.toEqual({ inserted: 0 });
    expect(snapshotServiceMock.backfillSnapshotsForPortfolio).not.toHaveBeenCalled();
  });

  it('uses earliest split date when it is earlier than transaction date and refreshes multiple portfolios', async () => {
    setupEm([], { portfolioRows: [
      { earliest_transaction_date: new Date('2026-05-18'), portfolio_key: 11 },
      { earliest_transaction_date: '2026-05-22', portfolio_key: 12 },
    ] });
    mockedGetSplits.mockResolvedValue([{ date: '2026-05-10', split: '4/1' }]);

    await expect(syncStockSplitsForAsset(asset)).resolves.toEqual({ inserted: 1 });
    expect(snapshotServiceMock.backfillSnapshotsForPortfolio).toHaveBeenNthCalledWith(1, 11, new Date('2026-05-10'));
    expect(snapshotServiceMock.backfillSnapshotsForPortfolio).toHaveBeenNthCalledWith(2, 12, new Date('2026-05-10'));
  });

  it('logs and continues when snapshot refresh fails after inserts', async () => {
    setupEm([], { portfolioRows: [{ earliest_transaction_date: '2026-05-18', portfolio_key: 11 }] });
    snapshotServiceMock.backfillSnapshotsForPortfolio.mockRejectedValueOnce(new Error('snapshot failed'));
    mockedGetSplits.mockResolvedValue([{ date: '2026-05-20', split: '4/1' }]);

    await expect(syncStockSplitsForAsset(asset)).resolves.toEqual({ inserted: 1 });
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.objectContaining({ portfolioKey: 11 }), 'Failed to refresh portfolio snapshots after stock split sync');
  });

  it('logs and continues when affected portfolio discovery fails', async () => {
    const getKyselyMock = vi.fn().mockImplementation(() => { throw new Error('discovery failed'); });
    const forkMock = vi.fn().mockReturnValue({ clear: vi.fn(), create: vi.fn(), find: vi.fn().mockResolvedValue([]), findOne: vi.fn(), findOneOrFail: vi.fn(), flush: vi.fn(), getKysely: getKyselyMock, getReference: vi.fn() });
    Object.assign(DI.em, { fork: forkMock });
    mockedGetSplits.mockResolvedValue([{ date: '2026-05-20', split: '4/1' }]);

    await expect(syncStockSplitsForAsset(asset)).resolves.toEqual({ inserted: 1 });
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.objectContaining({ assetKey: 7 }), 'Failed to discover affected portfolios for stock split snapshot refresh');
  });
});
