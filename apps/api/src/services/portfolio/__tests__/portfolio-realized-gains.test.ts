import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addPartner, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { addExchangeRate, type PortfolioSetup, seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { PortfolioCostBasisMethod } from '@app/constants/portfolio-cost-basis';
import { DI } from '@app/database/di';
import { Appuser } from '@entity/Appuser';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialAssetStockAdjustment } from '@entity/FinancialAssetStockAdjustment';
import { FinancialAssetType } from '@entity/FinancialAssetType';
import { Portfolio } from '@entity/Portfolio';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../stock-split-sync.service', async (importOriginal) => ({ ...(await importOriginal<object>()), syncStockSplitsForAsset: vi.fn() }));
vi.mock('../portfolio-snapshot.service', () => ({ default: { backfillSnapshotsForPortfolio: vi.fn() } }));
vi.mock('../asset-price.service', async (importOriginal) => {
  const original = (await importOriginal<{ default: object }>()).default;
  return { default: Object.assign(Object.create(original) as object, { ensureRecentAssetPrice: vi.fn() }) };
});

import portfolioHoldingsService from '../portfolio-holdings.service';
import portfolioTransactionService from '../portfolio-transaction.service';

/*
 * Realized gains per sale, per asset and per tax year, on real trades. Every sale is one
 * disposal out of the replay that prices holdings, so the per-sale figures add up to the
 * portfolio's realized total, under either cost basis method. Amounts are in the viewer's
 * currency; a year is a UTC calendar year.
 */
describe('realized gains report', () => {
  const db = useTestDatabase();
  let household: Household;
  let setup: PortfolioSetup;

  beforeEach(async () => {
    household = await seedHousehold(db.em());
    setup = await seedPortfolio(db.em(), household);
  });

  const tenantKey = () => household.tenant.tenantKey;

  const trade = (type: number, when: string, quantity: number, unitPrice: number, extra: Record<string, unknown> = {}, appuser: Appuser = setup.appuser) =>
    portfolioTransactionService.createPortfolioTransaction(appuser, {
      assetSymbol: setup.asset.symbol,
      financialAsset: setup.asset,
      financialTransactionTypeId: type,
      portfolioId: setup.portfolio.portfolioKey,
      quantity,
      settlementCurrencyId: setup.usd.currencyKey,
      skipMaintenance: true,
      transactionDate: new Date(when.length === 10 ? `${when}T00:00:00Z` : when),
      unitPrice,
      ...extra,
    }, setup.em);
  const buy = (when: string, quantity: number, unitPrice: number, extra: Record<string, unknown> = {}) => trade(FINANCIAL_TRANSACTION_TYPES.BUY, when, quantity, unitPrice, extra);
  const sell = (when: string, quantity: number, unitPrice: number, extra: Record<string, unknown> = {}) => trade(FINANCIAL_TRANSACTION_TYPES.SELL, when, quantity, unitPrice, extra);

  const setMethod = (method: PortfolioCostBasisMethod) =>
    DI.em.nativeUpdate(Portfolio, { portfolioKey: setup.portfolio.portfolioKey }, { costBasisMethod: method });

  const report = (options: { portfolioId?: number; year?: number } = {}) =>
    portfolioHoldingsService.getRealizedGainsReport(setup.appuser, { ...options, tenantKey: tenantKey() });

  const total = (portfolioId?: number) => portfolioHoldingsService.getRealizedGains(setup.appuser.appuserKey, portfolioId, tenantKey());

  const sumOf = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

  const addSecondAsset = async (symbol = 'MSFT') => {
    const stock = await DI.em.findOneOrFail(FinancialAssetType, { name: 'Stock' });
    const asset = DI.em.create(FinancialAsset, { currencyKey: setup.usd, financialAssetTypeKey: stock, name: `${symbol} Corp`, symbol }, { partial: true });
    await DI.em.flush();
    return asset;
  };

  const tradeAsset = (asset: FinancialAsset, type: number, day: string, quantity: number, unitPrice: number, portfolioId = setup.portfolio.portfolioKey) =>
    portfolioTransactionService.createPortfolioTransaction(setup.appuser, {
      assetSymbol: asset.symbol,
      financialAsset: asset,
      financialTransactionTypeId: type,
      portfolioId,
      quantity,
      settlementCurrencyId: setup.usd.currencyKey,
      skipMaintenance: true,
      transactionDate: new Date(`${day}T00:00:00Z`),
      unitPrice,
    }, setup.em);

  describe('per sale', () => {
    beforeEach(() => addExchangeRate(DI.em, setup.usd, household.currency, '2025-01-01', 1));

    it('reports each FIFO sale with its proceeds, relieved cost and holding period', async () => {
      await buy('2025-01-10', 10, 100, { feeAmount: 10, feeCurrencyId: setup.usd.currencyKey });
      await buy('2025-02-10', 10, 200);
      await sell('2025-03-10', 15, 250, { feeAmount: 5, feeCurrencyId: setup.usd.currencyKey });

      const result = await report();

      // 10 × 100 + the whole 10 fee + 5 × 200 = 2,010 relieved; 3,750 less the 5 fee received.
      expect(result.disposals).toEqual([
        expect.objectContaining({
          costBasis: 2010,
          financialAssetKey: setup.asset.financialAssetKey,
          holdingPeriodStart: '2025-01-10T00:00:00.000Z',
          portfolioKey: setup.portfolio.portfolioKey,
          proceeds: 3745,
          quantity: 15,
          realizedGain: 1735,
          symbol: 'AAPL',
        }),
      ]);
      expect(result.currencyCode).toBe('EUR');
    });

    it('reports each AVERAGE sale at the running average', async () => {
      await setMethod(PortfolioCostBasisMethod.AVERAGE);
      await buy('2025-01-10', 10, 100);
      await buy('2025-02-10', 10, 200);
      await sell('2025-03-10', 5, 250);
      await sell('2025-04-10', 5, 120);

      const result = await report();

      // Newest sale first.
      expect(result.disposals.map(({ costBasis, proceeds, realizedGain }) => ({ costBasis, proceeds, realizedGain }))).toEqual([
        { costBasis: 750, proceeds: 600, realizedGain: -150 },
        { costBasis: 750, proceeds: 1250, realizedGain: 500 },
      ]);
    });

    it('relieves split-adjusted lots for a sale after a split', async () => {
      await buy('2025-01-10', 10, 100);
      DI.em.create(FinancialAssetStockAdjustment, { date: new Date('2025-02-01T00:00:00Z'), denominator: 1, financialAssetKey: setup.asset, name: 'AAPL 2:1', numerator: 2, splitRatio: 2 }, { partial: true });
      await DI.em.flush();
      await sell('2025-03-10', 20, 60);

      const result = await report();

      expect(result.disposals).toEqual([expect.objectContaining({ costBasis: 1000, proceeds: 1200, quantity: 20, realizedGain: 200 })]);
    });

    it('reads a sale settled in another currency at its converted amounts', async () => {
      // A later rate: the buy converted at 1, the sale at 0.9 (its own day's rate).
      await addExchangeRate(DI.em, setup.usd, household.currency, '2025-03-01', 0.9);
      await buy('2025-01-10', 10, 100);
      await sell('2025-03-10', 10, 150);

      const result = await report();

      expect(result.disposals).toEqual([expect.objectContaining({ costBasis: 1000, currencyCode: 'EUR', proceeds: 1350, realizedGain: 350 })]);
      expect(result.totals).toMatchObject({ costBasis: 1000, proceeds: 1350, realizedGain: 350 });
      expect(result.completeness.isComplete).toBe(true);
    });
  });

  it.each([PortfolioCostBasisMethod.FIFO, PortfolioCostBasisMethod.AVERAGE])('adds per-sale gains up to the realized total of each portfolio under %s', async (method) => {
    await addExchangeRate(DI.em, setup.usd, household.currency, '2025-01-01', 0.93);
    await setMethod(method);
    const msft = await addSecondAsset();
    const second = DI.em.create(Portfolio, { costBasisMethod: method, currencyKey: household.currency, name: 'Second', portfolioOwnerAppuserKey: setup.appuser, tenantKey: household.tenant }, { partial: true });
    await DI.em.flush();

    await buy('2025-01-10', 7, 101.37, { feeAmount: 2.5, feeCurrencyId: setup.usd.currencyKey });
    await buy('2025-02-10', 3.5, 187.11);
    await sell('2025-03-10', 4.25, 212.4, { feeAmount: 1.2, feeCurrencyId: setup.usd.currencyKey });
    await sell('2025-11-10', 2, 99.99);
    await tradeAsset(msft, FINANCIAL_TRANSACTION_TYPES.BUY, '2025-01-12', 12, 33.33, second.portfolioKey);
    await tradeAsset(msft, FINANCIAL_TRANSACTION_TYPES.SELL, '2025-06-12', 5, 41.7, second.portfolioKey);
    await tradeAsset(msft, FINANCIAL_TRANSACTION_TYPES.SELL, '2026-01-12', 7, 29.01, second.portfolioKey);

    for (const portfolioId of [setup.portfolio.portfolioKey, second.portfolioKey, undefined]) {
      const [result, expected] = await Promise.all([report({ portfolioId }), total(portfolioId)]);
      expect(sumOf(result.disposals.map((disposal) => disposal.realizedGain))).toBeCloseTo(expected.totalRealizedGains, 2);
      expect(result.totals.realizedGain).toBeCloseTo(expected.totalRealizedGains, 2);
      expect(result.totals.costBasis).toBeCloseTo(expected.totalCostBasisOfSold, 2);
      expect(sumOf(result.byYear.map((year) => year.realizedGain))).toBeCloseTo(expected.totalRealizedGains, 2);
      expect(sumOf(result.byAsset.map((asset) => asset.realizedGain))).toBeCloseTo(expected.totalRealizedGains, 2);
    }
  });

  it('returns only the sales dated in the requested UTC year', async () => {
    await addExchangeRate(DI.em, setup.usd, household.currency, '2025-01-01', 1);
    await buy('2025-01-10', 10, 100);
    await sell('2025-12-31T23:59:59Z', 2, 150);
    await sell('2026-01-01T00:00:00Z', 3, 160);

    const in2025 = await report({ year: 2025 });
    const in2026 = await report({ year: 2026 });
    const lifetime = await report();

    expect(in2025.disposals.map((disposal) => disposal.quantity)).toEqual([2]);
    expect(in2025.totals.realizedGain).toBe(100);
    expect(in2026.disposals.map((disposal) => disposal.quantity)).toEqual([3]);
    expect(in2026.totals.realizedGain).toBe(180);
    expect(lifetime.byYear).toEqual([
      expect.objectContaining({ realizedGain: 100, sales: 1, year: 2025 }),
      expect.objectContaining({ realizedGain: 180, sales: 1, year: 2026 }),
    ]);
    // The year list stays whole under a filter, so a client can offer every year.
    expect(in2025.byYear.map((entry) => entry.year)).toEqual([2025, 2026]);
  });

  it('lists a fully sold asset as a closed position with its lifetime result', async () => {
    await addExchangeRate(DI.em, setup.usd, household.currency, '2025-01-01', 1);
    const msft = await addSecondAsset();
    await buy('2025-01-10', 10, 100);
    await sell('2025-03-10', 5, 150);
    await tradeAsset(msft, FINANCIAL_TRANSACTION_TYPES.BUY, '2025-01-12', 10, 30);
    await tradeAsset(msft, FINANCIAL_TRANSACTION_TYPES.SELL, '2025-06-12', 4, 40);
    await tradeAsset(msft, FINANCIAL_TRANSACTION_TYPES.SELL, '2026-02-12', 6, 25);

    const result = await report({ year: 2026 });

    // 4 × 10 gained in 2025 and 6 × 5 lost in 2026: a lifetime 10, whatever the year filter.
    expect(result.closedPositions).toEqual([
      expect.objectContaining({ financialAssetKey: msft.financialAssetKey, lastSaleDate: '2026-02-12T00:00:00.000Z', realizedGain: 10, sales: 2, symbol: 'MSFT' }),
    ]);

    const holdings = await portfolioHoldingsService.getPortfolioHoldings(setup.appuser, setup.portfolio.portfolioKey, tenantKey());
    expect(holdings.map((holding) => holding.financialAssetKey)).toEqual([setup.asset.financialAssetKey]);
    expect(holdings[0]).toMatchObject({ realizedGains: 250 });
  });

  it('converts a partner’s sale in their own currency into the viewer’s at the sale’s day', async () => {
    const usd = await currencyFor(DI.em, 'USD');
    const partner = await addPartner(db.em(), household, { currency: usd });
    const partnerUser = await DI.em.findOneOrFail(Appuser, { appuserKey: partner.appuserKey }, { filters: false, populate: ['currencyKey'] });
    await addExchangeRate(DI.em, setup.usd, household.currency, '2025-01-01', 0.5);
    await trade(FINANCIAL_TRANSACTION_TYPES.BUY, '2025-01-10', 10, 100, { tenantId: tenantKey() }, partnerUser);
    await trade(FINANCIAL_TRANSACTION_TYPES.SELL, '2025-03-10', 10, 150, { tenantId: tenantKey() }, partnerUser);

    const result = await report();

    // The partner's trades are in USD (their currency): a 500 USD gain is 250 EUR at 0.5.
    expect(result.disposals).toEqual([expect.objectContaining({ currencyCode: 'EUR', realizedGain: 250 })]);
    expect(result.totals.realizedGain).toBe(250);
  });

  it('leaves a sale with no rate into the viewer’s currency out of the totals and counts it', async () => {
    const usd = await currencyFor(DI.em, 'USD');
    const partner = await addPartner(db.em(), household, { currency: usd });
    const partnerUser = await DI.em.findOneOrFail(Appuser, { appuserKey: partner.appuserKey }, { filters: false, populate: ['currencyKey'] });
    await trade(FINANCIAL_TRANSACTION_TYPES.BUY, '2025-01-10', 10, 100, { tenantId: tenantKey() }, partnerUser);
    await trade(FINANCIAL_TRANSACTION_TYPES.SELL, '2025-03-10', 10, 150, { tenantId: tenantKey() }, partnerUser);

    const result = await report();

    expect(result.disposals).toEqual([expect.objectContaining({ currencyCode: 'USD', realizedGain: 500 })]);
    expect(result.totals.realizedGain).toBe(0);
    expect(result.completeness).toMatchObject({ isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
  });

  it('reads only the household’s own trades', async () => {
    await addExchangeRate(DI.em, setup.usd, household.currency, '2025-01-01', 1);
    await buy('2025-01-10', 10, 100);
    await sell('2025-03-10', 10, 150);
    const other = await seedHousehold(db.em());
    const outsider = await DI.em.findOneOrFail(Appuser, { appuserKey: other.appuser.appuserKey }, { filters: false, populate: ['currencyKey'] });

    const result = await portfolioHoldingsService.getRealizedGainsReport(outsider, { portfolioId: setup.portfolio.portfolioKey, tenantKey: other.tenant.tenantKey });

    expect(result.disposals).toEqual([]);
    expect(result.closedPositions).toEqual([]);
  });
});
