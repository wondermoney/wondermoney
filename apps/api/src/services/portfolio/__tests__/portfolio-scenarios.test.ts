import { beforeEach, describe, expect, it, vi } from 'vitest';

import { kyselyDouble } from '@app/__tests__/__helpers__/kysely-double';
import { DI } from '@app/database/di';

import {
  getPreferredSnapshotTotalValue,
  resolveHoldingCurrentMetrics,
  resolveHoldingUnitAmount,
} from '../portfolio-currency.utils';

vi.mock('@app/database/di', () => ({ DI: { em: {} } }));
vi.mock('../asset-price.service', () => ({ default: { ensureRecentAssetPrice: vi.fn() } }));

const portfolioSnapshotDeleteMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

type TransactionCallback = (em: typeof DI.em) => Promise<void> | void;

const runTransaction = (fn: TransactionCallback) => Promise.resolve(fn(DI.em));
const getPersistMock = () => (DI.em as unknown as { persist: ReturnType<typeof vi.fn> }).persist;

/** `getKysely` for a database that answers every query with `rows`. */
function makeDatabaseMock(rows: unknown[]) {
  return vi.fn(() => kyselyDouble(() => rows).db);
}

describe('portfolio aggregation scenarios', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock([]),
      nativeDelete: portfolioSnapshotDeleteMock,
      transactional: vi.fn(runTransaction),
    });
  });

  it('aggregates multi-currency portfolio values into user currency', () => {
    const holdings = [
      {
        averageBuyPrice: resolveHoldingUnitAmount({
          unit_appuser_amount: 120,
          unit_settlement_amount: 112.8,
        }),
        metrics: resolveHoldingCurrentMetrics({
          assetType: 'Stock',
          averageBuyPrice: 120,
          conversionRate: 0.94,
          quantity: 2,
          rawCurrentPrice: 130,
        }),
      },
      {
        averageBuyPrice: resolveHoldingUnitAmount({
          unit_appuser_amount: 1.06,
          unit_settlement_amount: 1,
        }),
        metrics: resolveHoldingCurrentMetrics({
          assetType: 'Cash',
          averageBuyPrice: 1.06,
          conversionRate: 1.06,
          quantity: 100,
          rawCurrentPrice: null,
        }),
      },
    ];

    const totalValue = holdings.reduce((sum, holding) => sum + (holding.metrics.currentValue ?? 0), 0);
    const costBasis = holdings.reduce((sum, holding) => {
      const quantity =
        holding.metrics.currentPrice == null || holding.metrics.currentValue == null
          ? 0
          : holding.metrics.currentValue / holding.metrics.currentPrice;

      return sum + holding.averageBuyPrice * quantity;
    }, 0);

    expect(totalValue).toBe(350.4);
    expect(costBasis).toBe(346);
  });

  it('prefers appuser snapshot values for net worth and performance baselines', () => {
    const snapshots = [
      { appuserCurrencyTotalValue: 106, totalValue: 100 },
      { appuserCurrencyTotalValue: 212, totalValue: 200 },
    ];

    const total = snapshots.reduce((sum, snapshot) => sum + getPreferredSnapshotTotalValue(snapshot), 0);

    expect(total).toBe(318);
  });

  it('keeps dividends and realized proceeds in the same user-currency system', () => {
    const dividends = [52.5, 18.25];
    const realizedSellProceeds = 240;
    const soldCostBasis = 210;

    const totalDividends = dividends.reduce((sum, value) => sum + value, 0);
    const realizedGains = realizedSellProceeds - soldCostBasis;

    expect(totalDividends).toBe(70.75);
    expect(realizedGains).toBe(30);
  });

  it('backfills historical snapshots from the earliest buy through today when prices exist', async () => {
    vi.setSystemTime(new Date('2024-01-04T12:00:00Z'));

    const { default: portfolioSnapshotService } = await import('../portfolio-snapshot.service');

    Object.assign((await import('@app/database/di')).DI.em, {
      find: vi.fn((entity): unknown[] => {
        if (entity?.name === 'FinancialTransaction') {
          return [
            {
              financialAssetKey: { financialAssetKey: 11, symbol: 'AAPL' },
              financialTransactionTypeKey: { name: 'BUY' },
              quantity: 2,
              settlementAmount: 200,
              transactionDate: new Date('2024-01-02T10:00:00Z'),
            },
          ];
        }
        if (entity?.name === 'FinancialAssetPrice') {
          return [
            { date: new Date('2024-01-02T00:00:00Z'), financialAssetKey: { financialAssetKey: 11 }, price: 100 },
            { date: new Date('2024-01-03T00:00:00Z'), financialAssetKey: { financialAssetKey: 11 }, price: 110 },
            { date: new Date('2024-01-04T00:00:00Z'), financialAssetKey: { financialAssetKey: 11 }, price: 120 },
          ];
        }
        if (entity?.name === 'ExchangeRate') {
          return [
            {
              date: new Date('2024-01-02T00:00:00Z'),
              fromCurrency: { currencyKey: 1 },
              rate: 0.9,
              toCurrency: { currencyKey: 2 },
            },
            {
              date: new Date('2024-01-03T00:00:00Z'),
              fromCurrency: { currencyKey: 1 },
              rate: 0.9,
              toCurrency: { currencyKey: 2 },
            },
            {
              date: new Date('2024-01-04T00:00:00Z'),
              fromCurrency: { currencyKey: 1 },
              rate: 0.9,
              toCurrency: { currencyKey: 2 },
            },
          ];
        }
        return [];
      }),
      findOne: vi.fn((entity): null | Record<string, unknown> => {
        if (entity?.name === 'Portfolio') {
          return {
            currencyKey: { code: 'USD', currencyKey: 1 },
            portfolioKey: 1,
            portfolioOwnerAppuserKey: { appuserKey: 1, currencyKey: { code: 'EUR', currencyKey: 2 } },
          };
        }
        return null;
      }),
      flush: vi.fn(),
      getKysely: makeDatabaseMock([
        { date: '2024-01-02 00:00:00+00', financial_asset_key: 11, price: 100 },
        { date: '2024-01-03', financial_asset_key: 11, price: 110 },
        { date: '2024-01-04', financial_asset_key: 11, price: 120 },
      ]),
      persist: vi.fn().mockReturnThis(),
    });

    await portfolioSnapshotService.backfillSnapshotsForPortfolio(1);

    const persistCalls = getPersistMock().mock.calls;
    expect(persistCalls).toHaveLength(3);
    expect(persistCalls[0]?.[0]).toEqual(
      expect.objectContaining({
        appuserCurrencyCostBasis: 180,
        appuserCurrencyTotalValue: 180,
        costBasis: 200,
        snapshotDate: new Date('2024-01-02T00:00:00.000Z'),
        totalValue: 200,
      }),
    );
    expect(persistCalls[2]?.[0]).toEqual(
      expect.objectContaining({
        appuserCurrencyCostBasis: 180,
        appuserCurrencyTotalValue: 216,
        costBasis: 200,
        snapshotDate: new Date('2024-01-04T00:00:00.000Z'),
        totalValue: 240,
      }),
    );
  });

  it('backfills fee-inclusive FIFO cost basis before and after a partial sale', async () => {
    vi.setSystemTime(new Date('2024-01-04T12:00:00Z'));

    const { default: portfolioSnapshotService } = await import('../portfolio-snapshot.service');
    const currency = { code: 'USD', currencyKey: 1 };
    Object.assign((await import('@app/database/di')).DI.em, {
      find: vi.fn((entity): unknown[] => {
        if (entity?.name === 'FinancialTransaction') {
          return [
            {
              feeAmount: 2,
              feeCurrencyKey: currency,
              financialAssetKey: { currencyKey: currency, financialAssetKey: 11, financialAssetTypeKey: { name: 'Stock' } },
              financialTransactionTypeKey: { name: 'BUY' },
              quantity: 10,
              settlementAmount: 100,
              settlementCurrencyKey: currency,
              transactionDate: new Date('2024-01-02T10:00:00Z'),
              transactionKey: 1,
            },
            {
              feeAmount: -1,
              feeCurrencyKey: currency,
              financialAssetKey: { currencyKey: currency, financialAssetKey: 11, financialAssetTypeKey: { name: 'Stock' } },
              financialTransactionTypeKey: { name: 'SELL' },
              quantity: -4,
              settlementAmount: -60,
              settlementCurrencyKey: currency,
              transactionDate: new Date('2024-01-03T10:00:00Z'),
              transactionKey: 2,
            },
          ];
        }
        if (entity?.name === 'FinancialAssetPrice') {
          return [
            { date: new Date('2024-01-02T00:00:00Z'), financialAssetKey: { financialAssetKey: 11 }, price: 20 },
            { date: new Date('2024-01-03T00:00:00Z'), financialAssetKey: { financialAssetKey: 11 }, price: 20 },
            { date: new Date('2024-01-04T00:00:00Z'), financialAssetKey: { financialAssetKey: 11 }, price: 20 },
          ];
        }
        return [];
      }),
      findOne: vi.fn((entity): null | Record<string, unknown> => {
        if (entity?.name === 'Portfolio') {
          return {
            currencyKey: currency,
            portfolioKey: 1,
            portfolioOwnerAppuserKey: { appuserKey: 1, currencyKey: currency },
          };
        }
        return null;
      }),
      flush: vi.fn(),
      getKysely: makeDatabaseMock([
        { date: '2024-01-02', financial_asset_key: 11, price: 20 },
        { date: '2024-01-03', financial_asset_key: 11, price: 20 },
        { date: '2024-01-04', financial_asset_key: 11, price: 20 },
      ]),
      persist: vi.fn().mockReturnThis(),
    });

    await portfolioSnapshotService.backfillSnapshotsForPortfolio(1);

    const snapshots = getPersistMock().mock.calls.map(([snapshot]) => snapshot as { costBasis: number; snapshotDate: Date });
    expect(snapshots.map(({ costBasis }) => costBasis)).toEqual([102, 61.2, 61.2]);
  });

  it('skips a lot with no settlement rate even when its fee is in that currency, as before fees counted', async () => {
    vi.setSystemTime(new Date('2024-01-03T12:00:00Z'));

    const { default: portfolioSnapshotService } = await import('../portfolio-snapshot.service');
    const usd = { code: 'USD', currencyKey: 1 };
    const eur = { code: 'EUR', currencyKey: 2 };
    Object.assign((await import('@app/database/di')).DI.em, {
      find: vi.fn((entity): unknown[] => {
        if (entity?.name === 'FinancialTransaction') {
          return [
            {
              feeAmount: 1,
              feeCurrencyKey: eur,
              financialAssetKey: { currencyKey: usd, financialAssetKey: 11, financialAssetTypeKey: { name: 'Stock' } },
              financialTransactionTypeKey: { name: 'BUY' },
              quantity: 5,
              settlementAmount: 50,
              settlementCurrencyKey: eur,
              transactionDate: new Date('2024-01-02T09:00:00Z'),
              transactionKey: 1,
            },
            {
              feeAmount: 2,
              feeCurrencyKey: usd,
              financialAssetKey: { currencyKey: usd, financialAssetKey: 11, financialAssetTypeKey: { name: 'Stock' } },
              financialTransactionTypeKey: { name: 'BUY' },
              quantity: 10,
              settlementAmount: 100,
              settlementCurrencyKey: usd,
              transactionDate: new Date('2024-01-02T10:00:00Z'),
              transactionKey: 2,
            },
          ];
        }
        if (entity?.name === 'FinancialAssetPrice') {
          return [
            { date: new Date('2024-01-02T00:00:00Z'), financialAssetKey: { financialAssetKey: 11 }, price: 20 },
            { date: new Date('2024-01-03T00:00:00Z'), financialAssetKey: { financialAssetKey: 11 }, price: 20 },
          ];
        }
        return [];
      }),
      findOne: vi.fn((entity): null | Record<string, unknown> => {
        if (entity?.name === 'Portfolio') {
          return { currencyKey: usd, portfolioKey: 1, portfolioOwnerAppuserKey: { appuserKey: 1, currencyKey: usd } };
        }
        return null;
      }),
      flush: vi.fn(),
      getKysely: makeDatabaseMock([
        { date: '2024-01-02', financial_asset_key: 11, price: 20 },
        { date: '2024-01-03', financial_asset_key: 11, price: 20 },
      ]),
      persist: vi.fn().mockReturnThis(),
    });

    await portfolioSnapshotService.backfillSnapshotsForPortfolio(1);

    const snapshots = getPersistMock().mock.calls.map(([snapshot]) => snapshot as { costBasis: number });
    expect(snapshots.map(({ costBasis }) => costBasis)).toEqual([102, 102]);
  });

  it.each([
    { case: 'a fee currency with no rate', fee: { feeAmount: 2, feeCurrencyKey: { code: 'GBP', currencyKey: 3 } } },
    { case: 'no fee currency', fee: { feeAmount: 2, feeCurrencyKey: undefined } },
  ])('counts a buy fee with $case as zero in snapshot cost basis instead of failing', async ({ fee }) => {
    vi.setSystemTime(new Date('2024-01-03T12:00:00Z'));

    const { default: portfolioSnapshotService } = await import('../portfolio-snapshot.service');
    const usd = { code: 'USD', currencyKey: 1 };
    Object.assign((await import('@app/database/di')).DI.em, {
      find: vi.fn((entity): unknown[] => {
        if (entity?.name === 'FinancialTransaction') {
          return [{
            ...fee,
            financialAssetKey: { currencyKey: usd, financialAssetKey: 11, financialAssetTypeKey: { name: 'Stock' } },
            financialTransactionTypeKey: { name: 'BUY' },
            quantity: 10,
            settlementAmount: 100,
            settlementCurrencyKey: usd,
            transactionDate: new Date('2024-01-02T10:00:00Z'),
            transactionKey: 1,
          }];
        }
        if (entity?.name === 'FinancialAssetPrice') {
          return [
            { date: new Date('2024-01-02T00:00:00Z'), financialAssetKey: { financialAssetKey: 11 }, price: 20 },
            { date: new Date('2024-01-03T00:00:00Z'), financialAssetKey: { financialAssetKey: 11 }, price: 20 },
          ];
        }
        return [];
      }),
      findOne: vi.fn((entity): null | Record<string, unknown> => (entity?.name === 'Portfolio'
        ? { currencyKey: usd, portfolioKey: 1, portfolioOwnerAppuserKey: { appuserKey: 1, currencyKey: usd } }
        : null)),
      flush: vi.fn(),
      getKysely: makeDatabaseMock([
        { date: '2024-01-02', financial_asset_key: 11, price: 20 },
        { date: '2024-01-03', financial_asset_key: 11, price: 20 },
      ]),
      persist: vi.fn().mockReturnThis(),
    });

    await portfolioSnapshotService.backfillSnapshotsForPortfolio(1);

    const snapshots = getPersistMock().mock.calls.map(([snapshot]) => snapshot as { costBasis: number });
    expect(snapshots.map(({ costBasis }) => costBasis)).toEqual([100, 100]);
  });

  it('keeps sub-cent remaining purchase fees in partial-sale snapshot cost basis', async () => {
    vi.setSystemTime(new Date('2024-01-03T12:00:00Z'));

    const { default: portfolioSnapshotService } = await import('../portfolio-snapshot.service');
    const currency = { code: 'EUR', currencyKey: 1 };
    Object.assign((await import('@app/database/di')).DI.em, {
      find: vi.fn((entity): unknown[] => {
        if (entity?.name === 'FinancialTransaction') {
          return [
            {
              feeAmount: 0.01,
              feeCurrencyKey: currency,
              financialAssetKey: { currencyKey: currency, financialAssetKey: 11, financialAssetTypeKey: { name: 'Stock' } },
              financialTransactionTypeKey: { name: 'BUY' },
              quantity: 2,
              settlementAmount: 199.98,
              settlementCurrencyKey: currency,
              transactionDate: new Date('2024-01-01T10:00:00Z'),
              transactionKey: 1,
            },
            {
              feeAmount: 0,
              feeCurrencyKey: currency,
              financialAssetKey: { currencyKey: currency, financialAssetKey: 11, financialAssetTypeKey: { name: 'Stock' } },
              financialTransactionTypeKey: { name: 'SELL' },
              quantity: -1,
              settlementAmount: -120,
              settlementCurrencyKey: currency,
              transactionDate: new Date('2024-01-02T10:00:00Z'),
              transactionKey: 2,
            },
          ];
        }
        return [];
      }),
      findOne: vi.fn((entity): null | Record<string, unknown> => {
        if (entity?.name === 'Portfolio') {
          return { currencyKey: currency, portfolioKey: 1, portfolioOwnerAppuserKey: { appuserKey: 1, currencyKey: currency } };
        }
        return null;
      }),
      flush: vi.fn(),
      getKysely: makeDatabaseMock([
        { date: '2024-01-01', financial_asset_key: 11, price: 99.99 },
        { date: '2024-01-02', financial_asset_key: 11, price: 120 },
        { date: '2024-01-03', financial_asset_key: 11, price: 120 },
      ]),
      persist: vi.fn().mockReturnThis(),
    });

    await portfolioSnapshotService.backfillSnapshotsForPortfolio(1);

    const snapshots = getPersistMock().mock.calls.map(([snapshot]) => snapshot as { costBasis: number; totalValue: number });
    expect(snapshots[0]).toMatchObject({ costBasis: 199.99, totalValue: 199.98 });
    expect(snapshots[1]).toMatchObject({ costBasis: 100, totalValue: 120 });
    expect(snapshots[2]).toMatchObject({ costBasis: 100, totalValue: 120 });
  });

  it.each([0, -0.5, Number.NaN, Number.POSITIVE_INFINITY])('counts a fee with an invalid historical FX rate (%s) as zero during snapshot backfill', async (rate) => {
    vi.setSystemTime(new Date('2024-01-02T12:00:00Z'));

    const { default: portfolioSnapshotService } = await import('../portfolio-snapshot.service');
    const usd = { code: 'USD', currencyKey: 1 };
    const eur = { code: 'EUR', currencyKey: 2 };
    Object.assign((await import('@app/database/di')).DI.em, {
      find: vi.fn((entity): unknown[] => {
        if (entity?.name === 'FinancialTransaction') {
          return [{
            feeAmount: 1,
            feeCurrencyKey: usd,
            financialAssetKey: { currencyKey: eur, financialAssetKey: 11, financialAssetTypeKey: { name: 'Stock' } },
            financialTransactionTypeKey: { name: 'BUY' },
            quantity: 1,
            settlementAmount: 100,
            settlementCurrencyKey: eur,
            transactionDate: new Date('2024-01-02T10:00:00Z'),
            transactionKey: 1,
          }];
        }
        if (entity?.name === 'ExchangeRate') return [{ date: new Date('2024-01-02T00:00:00Z'), fromCurrency: usd, rate, toCurrency: eur }];
        return [];
      }),
      findOne: vi.fn((entity): null | Record<string, unknown> => entity?.name === 'Portfolio'
        ? { currencyKey: eur, portfolioKey: 1, portfolioOwnerAppuserKey: { appuserKey: 1, currencyKey: eur } }
        : null),
      flush: vi.fn(),
      getKysely: makeDatabaseMock([{ date: '2024-01-02 00:00:00+00', financial_asset_key: 11, price: 100 }]),
      persist: vi.fn().mockReturnThis(),
    });

    await portfolioSnapshotService.backfillSnapshotsForPortfolio(1);

    const snapshots = getPersistMock().mock.calls.map(([snapshot]) => snapshot as { costBasis: number });
    expect(snapshots.map(({ costBasis }) => costBasis)).toEqual([100]);
  });

  it('values snapshot purchase fees in portfolio currency using acquisition-date FX', async () => {
    vi.setSystemTime(new Date('2024-01-02T12:00:00Z'));

    const { default: portfolioSnapshotService } = await import('../portfolio-snapshot.service');
    const usd = { code: 'USD', currencyKey: 1 };
    const eur = { code: 'EUR', currencyKey: 2 };
    const gbp = { code: 'GBP', currencyKey: 3 };
    Object.assign((await import('@app/database/di')).DI.em, {
      find: vi.fn((entity, where): unknown[] => {
        if (entity?.name === 'FinancialTransaction') {
          return [
            {
              feeAmount: 10,
              feeCurrencyKey: usd,
              financialAssetKey: { currencyKey: usd, financialAssetKey: 11, financialAssetTypeKey: { name: 'Stock' } },
              financialTransactionTypeKey: { name: 'BUY' },
              quantity: 2,
              settlementAmount: 200,
              settlementCurrencyKey: usd,
              transactionDate: new Date('2024-01-02T10:00:00Z'),
              transactionKey: 1,
            },
          ];
        }
        if (entity?.name === 'ExchangeRate') {
          const query = where as { date?: { $lte?: Date }; fromCurrency?: { currencyKey?: number }; toCurrency?: { currencyKey?: number } };
          const rows = [
            { date: new Date('2024-02-01T00:00:00Z'), fromCurrency: usd, rate: 0.99, toCurrency: gbp },
            { date: new Date('2024-01-02T00:00:00Z'), fromCurrency: usd, rate: 0.7, toCurrency: gbp },
            { date: new Date('2024-02-01T00:00:00Z'), fromCurrency: gbp, rate: 0.95, toCurrency: eur },
            { date: new Date('2024-01-02T00:00:00Z'), fromCurrency: gbp, rate: 0.8, toCurrency: eur },
          ];
          return rows
            .filter((row) => row.fromCurrency.currencyKey === query.fromCurrency?.currencyKey)
            .filter((row) => row.toCurrency.currencyKey === query.toCurrency?.currencyKey)
            .filter((row) => query.date?.$lte == null || row.date <= query.date.$lte)
            .toSorted((a, b) => b.date.getTime() - a.date.getTime());
        }
        if (entity?.name === 'FinancialAssetPrice') {
          return [{ date: new Date('2024-01-02T00:00:00Z'), financialAssetKey: { financialAssetKey: 11 }, price: 100 }];
        }
        return [];
      }),
      findOne: vi.fn((entity): null | Record<string, unknown> => {
        if (entity?.name === 'Portfolio') {
          return {
            currencyKey: gbp,
            portfolioKey: 1,
            portfolioOwnerAppuserKey: { appuserKey: 1, currencyKey: eur },
          };
        }
        return null;
      }),
      flush: vi.fn(),
      getKysely: makeDatabaseMock([{ date: '2024-01-02 00:00:00+00', financial_asset_key: 11, price: 100 }]),
      persist: vi.fn().mockReturnThis(),
    });

    await portfolioSnapshotService.backfillSnapshotsForPortfolio(1);

    expect(getPersistMock().mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      appuserCurrencyCostBasis: 117.6,
      costBasis: 147,
      snapshotDate: new Date('2024-01-02T00:00:00.000Z'),
    }));
  });

  it('backfills snapshots with split-adjusted holdings and unchanged cost basis', async () => {
    vi.setSystemTime(new Date('2024-01-04T12:00:00Z'));

    const { default: portfolioSnapshotService } = await import('../portfolio-snapshot.service');

    Object.assign((await import('@app/database/di')).DI.em, {
      find: vi.fn((entity): unknown[] => {
        if (entity?.name === 'FinancialTransaction') {
          return [
            {
              financialAssetKey: { financialAssetKey: 11, symbol: 'AAPL' },
              financialTransactionTypeKey: { name: 'BUY' },
              quantity: 2,
              settlementAmount: 200,
              transactionDate: new Date('2024-01-02T10:00:00Z'),
            },
          ];
        }
        if (entity?.name === 'FinancialAssetStockAdjustment') {
          return [
            {
              date: new Date('2024-01-03T00:00:00Z'),
              denominator: 1,
              financialAssetKey: { financialAssetKey: 11 },
              numerator: 4,
              splitRatio: 4,
            },
          ];
        }
        if (entity?.name === 'FinancialAssetPrice') {
          return [
            { date: new Date('2024-01-02T00:00:00Z'), financialAssetKey: { financialAssetKey: 11 }, price: 100 },
            { date: new Date('2024-01-03T00:00:00Z'), financialAssetKey: { financialAssetKey: 11 }, price: 10 },
            { date: new Date('2024-01-04T00:00:00Z'), financialAssetKey: { financialAssetKey: 11 }, price: 10 },
          ];
        }
        if (entity?.name === 'ExchangeRate') {
          return [];
        }
        return [];
      }),
      findOne: vi.fn((entity): null | Record<string, unknown> => {
        if (entity?.name === 'Portfolio') {
          return {
            currencyKey: { code: 'USD', currencyKey: 1 },
            portfolioKey: 1,
            portfolioOwnerAppuserKey: { appuserKey: 1, currencyKey: { code: 'USD', currencyKey: 1 } },
          };
        }
        return null;
      }),
      flush: vi.fn(),
      getKysely: makeDatabaseMock([
        { date: new Date('2024-01-02T00:00:00Z'), financial_asset_key: 11, price: 100 },
        { date: new Date('2024-01-03T00:00:00Z'), financial_asset_key: 11, price: 10 },
        { date: new Date('2024-01-04T00:00:00Z'), financial_asset_key: 11, price: 10 },
      ]),
      persist: vi.fn().mockReturnThis(),
    });

    await portfolioSnapshotService.backfillSnapshotsForPortfolio(1);

    const persistCalls = getPersistMock().mock.calls;
    expect(persistCalls).toHaveLength(3);
    expect(persistCalls[2]?.[0]).toEqual(
      expect.objectContaining({
        appuserCurrencyCostBasis: 200,
        costBasis: 200,
        snapshotDate: new Date('2024-01-04T00:00:00.000Z'),
        totalValue: 80,
      }),
    );
  });

  it('populates appuser currency snapshot values for same-currency portfolios', async () => {
    vi.setSystemTime(new Date('2024-01-04T12:00:00Z'));

    const { default: portfolioSnapshotService } = await import('../portfolio-snapshot.service');

    Object.assign((await import('@app/database/di')).DI.em, {
      find: vi.fn((entity): unknown[] => {
        if (entity?.name === 'FinancialTransaction') {
          return [
            {
              financialAssetKey: { financialAssetKey: 11, symbol: 'AAPL' },
              financialTransactionTypeKey: { name: 'BUY' },
              quantity: 1,
              settlementAmount: 100,
              transactionDate: new Date('2024-01-02T10:00:00Z'),
            },
          ];
        }
        if (entity?.name === 'FinancialAssetPrice') {
          return [{ date: new Date('2024-01-02T00:00:00Z'), financialAssetKey: { financialAssetKey: 11 }, price: 100 }];
        }
        return [];
      }),
      findOne: vi.fn((entity): null | Record<string, unknown> => {
        if (entity?.name === 'Portfolio') {
          return {
            currencyKey: { code: 'USD', currencyKey: 1 },
            portfolioKey: 1,
            portfolioOwnerAppuserKey: { appuserKey: 1, currencyKey: { code: 'USD', currencyKey: 1 } },
          };
        }
        return null;
      }),
      flush: vi.fn(),
      getKysely: makeDatabaseMock([{ date: new Date('2024-01-02T00:00:00Z'), financial_asset_key: 11, price: 100 }]),
      persist: vi.fn().mockReturnThis(),
    });

    await portfolioSnapshotService.backfillSnapshotsForPortfolio(1);

    expect(getPersistMock().mock.calls).toHaveLength(3);
    expect(getPersistMock().mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        appuserCurrencyCostBasis: 100,
        appuserCurrencyKey: { code: 'USD', currencyKey: 1 },
        appuserCurrencyTotalValue: 100,
      }),
    );
    expect(getPersistMock().mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({ snapshotDate: new Date('2024-01-04T00:00:00.000Z'), totalValue: 100 }),
    );
  });

  it('converts BUY settlement cost basis using the latest carry-forward exchange rate', async () => {
    vi.setSystemTime(new Date('2024-01-04T12:00:00Z'));

    const { default: portfolioSnapshotService } = await import('../portfolio-snapshot.service');

    Object.assign((await import('@app/database/di')).DI.em, {
      find: vi.fn((entity): unknown[] => {
        if (entity?.name === 'FinancialTransaction') {
          return [
            {
              financialAssetKey: {
                currencyKey: { code: 'USD', currencyKey: 1 },
                financialAssetKey: 11,
                symbol: 'AAPL',
              },
              financialTransactionTypeKey: { name: 'BUY' },
              quantity: 1,
              settlementAmount: 100,
              settlementCurrencyKey: { code: 'USD', currencyKey: 1 },
              transactionDate: new Date('2024-01-02T00:00:00Z'),
            },
          ];
        }
        if (entity?.name === 'FinancialAssetPrice') {
          return [{ date: new Date('2024-01-02T00:00:00Z'), financialAssetKey: { financialAssetKey: 11 }, price: 100 }];
        }
        if (entity?.name === 'ExchangeRate') {
          return [
            {
              date: new Date('2024-01-01T00:00:00Z'),
              fromCurrency: { code: 'USD', currencyKey: 1 },
              rate: 0.9,
              toCurrency: { code: 'EUR', currencyKey: 2 },
            },
          ];
        }
        return [];
      }),
      findOne: vi.fn((entity): null | Record<string, unknown> => {
        if (entity?.name === 'Portfolio') {
          return {
            currencyKey: { code: 'EUR', currencyKey: 2 },
            portfolioKey: 1,
            portfolioOwnerAppuserKey: { appuserKey: 1, currencyKey: { code: 'EUR', currencyKey: 2 } },
          };
        }
        return null;
      }),
      flush: vi.fn(),
      getKysely: makeDatabaseMock([{ date: new Date('2024-01-02T00:00:00Z'), financial_asset_key: 11, price: 100 }]),
      nativeDelete: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn().mockReturnThis(),
      transactional: vi.fn(runTransaction),
    });

    await portfolioSnapshotService.backfillSnapshotsForPortfolio(1);

    expect(getPersistMock().mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ appuserCurrencyCostBasis: 90, costBasis: 90, totalValue: 90 }),
    );
  });

  it('throws when no carry-forward exchange rate exists for a cross-currency portfolio', async () => {
    vi.setSystemTime(new Date('2024-01-04T12:00:00Z'));

    const { default: portfolioSnapshotService } = await import('../portfolio-snapshot.service');

    Object.assign((await import('@app/database/di')).DI.em, {
      find: vi.fn((entity): unknown[] => {
        if (entity?.name === 'FinancialTransaction') {
          return [
            {
              financialAssetKey: { financialAssetKey: 11, symbol: 'AAPL' },
              financialTransactionTypeKey: { name: 'BUY' },
              quantity: 1,
              settlementAmount: 100,
              transactionDate: new Date('2024-01-02T10:00:00Z'),
            },
          ];
        }
        if (entity?.name === 'FinancialAssetPrice') {
          return [{ date: new Date('2024-01-02T00:00:00Z'), financialAssetKey: { financialAssetKey: 11 }, price: 100 }];
        }
        if (entity?.name === 'ExchangeRate') return [];
        return [];
      }),
      findOne: vi.fn((entity): null | Record<string, unknown> => {
        if (entity?.name === 'Portfolio') {
          return {
            currencyKey: { code: 'USD', currencyKey: 1 },
            portfolioKey: 1,
            portfolioOwnerAppuserKey: { appuserKey: 1, currencyKey: { code: 'EUR', currencyKey: 2 } },
          };
        }
        return null;
      }),
      flush: vi.fn(),
      getKysely: makeDatabaseMock([{ date: new Date('2024-01-02T00:00:00Z'), financial_asset_key: 11, price: 100 }]),
      nativeDelete: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn().mockReturnThis(),
      transactional: vi.fn(runTransaction),
    });

    await expect(portfolioSnapshotService.backfillSnapshotsForPortfolio(1)).rejects.toThrow(/Missing exchange rate/);
  });

  it('clears stale snapshots when a portfolio has no remaining BUY/SELL transactions', async () => {
    vi.setSystemTime(new Date('2024-01-04T12:00:00Z'));

    const { default: portfolioSnapshotService } = await import('../portfolio-snapshot.service');

    Object.assign((await import('@app/database/di')).DI.em, {
      find: vi.fn((entity): unknown[] => {
        if (entity?.name === 'FinancialTransaction') return [];
        if (entity?.name === 'PortfolioSnapshot') {
          return [{ portfolioSnapshotKey: 1, snapshotDate: new Date('2024-01-02T00:00:00Z') }];
        }
        return [];
      }),
      findOne: vi.fn((entity, where) => {
        if (entity?.name === 'Portfolio') {
          return {
            currencyKey: { code: 'USD', currencyKey: 1 },
            portfolioKey: 1,
            portfolioOwnerAppuserKey: { appuserKey: 1, currencyKey: { code: 'USD', currencyKey: 1 } },
          };
        }
        if (entity?.name === 'PortfolioSnapshot' && where?.snapshotDate) {
          return { portfolioSnapshotKey: 1, snapshotDate: where.snapshotDate, totalValue: 100 };
        }
        return null;
      }),
      flush: vi.fn(),
      getKysely: makeDatabaseMock([]),
      nativeDelete: portfolioSnapshotDeleteMock,
      persist: vi.fn().mockReturnThis(),
      transactional: vi.fn(runTransaction),
    });

    await portfolioSnapshotService.backfillSnapshotsForPortfolio(1, new Date('2024-01-02T00:00:00Z'));

    expect(portfolioSnapshotDeleteMock.mock.calls.length).toBeGreaterThan(0);
  });

  it('does not increase holdings for negative SELL quantities and uses FIFO cost basis', async () => {
    vi.setSystemTime(new Date('2024-01-04T12:00:00Z'));

    const { default: portfolioSnapshotService } = await import('../portfolio-snapshot.service');

    Object.assign((await import('@app/database/di')).DI.em, {
      find: vi.fn((entity) => {
        if (entity?.name === 'FinancialTransaction') {
          return [
            {
              financialAssetKey: { financialAssetKey: 11, symbol: 'AAPL' },
              financialTransactionTypeKey: { name: 'BUY' },
              quantity: 1,
              settlementAmount: 100,
              transactionDate: new Date('2024-01-01T00:00:00Z'),
            },
            {
              financialAssetKey: { financialAssetKey: 11, symbol: 'AAPL' },
              financialTransactionTypeKey: { name: 'BUY' },
              quantity: 1,
              settlementAmount: 200,
              transactionDate: new Date('2024-01-02T00:00:00Z'),
            },
            {
              financialAssetKey: { financialAssetKey: 11, symbol: 'AAPL' },
              financialTransactionTypeKey: { name: 'SELL' },
              quantity: -1,
              settlementAmount: -150,
              transactionDate: new Date('2024-01-03T00:00:00Z'),
            },
          ];
        }
        if (entity?.name === 'FinancialAssetPrice') {
          return [{ date: new Date('2024-01-03T00:00:00Z'), financialAssetKey: { financialAssetKey: 11 }, price: 120 }];
        }
        return [];
      }),
      findOne: vi.fn((entity): null | Record<string, unknown> => {
        if (entity?.name === 'Portfolio') {
          return {
            currencyKey: { code: 'USD', currencyKey: 1 },
            portfolioKey: 1,
            portfolioOwnerAppuserKey: { appuserKey: 1, currencyKey: { code: 'USD', currencyKey: 1 } },
          };
        }
        return null;
      }),
      flush: vi.fn(),
      getKysely: makeDatabaseMock([{ date: new Date('2024-01-03T00:00:00Z'), financial_asset_key: 11, price: 120 }]),
      nativeDelete: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn().mockReturnThis(),
      transactional: vi.fn(runTransaction),
    });

    await portfolioSnapshotService.backfillSnapshotsForPortfolio(1);

    expect(getPersistMock().mock.calls[0]?.[0]).toEqual(expect.objectContaining({ costBasis: 200, totalValue: 120 }));
  });

  it('carries forward the latest FX rate when exact snapshot date rate is missing', async () => {
    vi.setSystemTime(new Date('2024-01-04T12:00:00Z'));

    const { default: portfolioSnapshotService } = await import('../portfolio-snapshot.service');
    let exchangeRateQuery: Date | undefined;

    Object.assign((await import('@app/database/di')).DI.em, {
      find: vi.fn((entity, where): unknown[] => {
        if (entity?.name === 'FinancialTransaction') {
          return [
            {
              financialAssetKey: { financialAssetKey: 11, symbol: 'AAPL' },
              financialTransactionTypeKey: { name: 'BUY' },
              quantity: 1,
              settlementAmount: 100,
              transactionDate: new Date('2024-01-02T00:00:00Z'),
            },
          ];
        }
        if (entity?.name === 'FinancialAssetPrice') {
          return [{ date: new Date('2024-01-02T00:00:00Z'), financialAssetKey: { financialAssetKey: 11 }, price: 100 }];
        }
        if (entity?.name === 'ExchangeRate') {
          exchangeRateQuery = where?.date?.$lte as Date | undefined;
          return [
            {
              date: new Date('2024-01-02T00:00:00Z'),
              fromCurrency: { currencyKey: 1 },
              rate: 0.9,
              toCurrency: { currencyKey: 2 },
            },
          ];
        }
        return [];
      }),
      findOne: vi.fn((entity) => {
        if (entity?.name === 'Portfolio') {
          return {
            currencyKey: { code: 'USD', currencyKey: 1 },
            portfolioKey: 1,
            portfolioOwnerAppuserKey: { appuserKey: 1, currencyKey: { code: 'EUR', currencyKey: 2 } },
          };
        }
        return null;
      }),
      flush: vi.fn(),
      getKysely: makeDatabaseMock([{ date: new Date('2024-01-02T00:00:00Z'), financial_asset_key: 11, price: 100 }]),
      nativeDelete: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn().mockReturnThis(),
      transactional: vi.fn(runTransaction),
    });

    await portfolioSnapshotService.backfillSnapshotsForPortfolio(1, new Date('2024-01-04T00:00:00Z'));

    expect(exchangeRateQuery).toBeDefined();
    expect(getPersistMock().mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ appuserCurrencyCostBasis: 90, appuserCurrencyTotalValue: 90 }),
    );
  });
});
