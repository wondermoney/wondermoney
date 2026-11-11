import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { addExchangeRate, type PortfolioSetup, seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { PortfolioCostBasisMethod } from '@app/constants/portfolio-cost-basis';
import { DI } from '@app/database/di';
import type { Appuser } from '@entity/Appuser';
import { FinancialAsset } from '@entity/FinancialAsset';
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
 * Cost basis method on a real portfolio. The acceptance example is 10 shares at 100, 10 at 200,
 * then a sale of 10: under AVERAGE the sale relieves 1,500 and the remaining average is 150;
 * under FIFO it relieves 1,000 and the remaining average is 200.
 */
describe('portfolio cost basis method', () => {
  const db = useTestDatabase();
  let household: Household;
  let setup: PortfolioSetup;
  let partner: Appuser;

  beforeEach(async () => {
    household = await seedHousehold(db.em());
    setup = await seedPortfolio(db.em(), household);
    partner = await addPartner(db.em(), household);
  });

  /** USD settles into the household's EUR at `rate`, so the acceptance numbers stay exact at 1. */
  const useRate = (rate: number) => addExchangeRate(DI.em, setup.usd, household.currency, '2026-07-17', rate);

  const setMethod = async (method: PortfolioCostBasisMethod) => {
    await DI.em.nativeUpdate(Portfolio, { portfolioKey: setup.portfolio.portfolioKey }, { costBasisMethod: method });
  };

  const trade = (appuser: Appuser, type: number, day: string, quantity: number, unitPrice: number, extra: Record<string, unknown> = {}) =>
    portfolioTransactionService.createPortfolioTransaction(appuser, {
      assetSymbol: setup.asset.symbol,
      financialAsset: setup.asset,
      financialTransactionTypeId: type,
      portfolioId: setup.portfolio.portfolioKey,
      quantity,
      settlementCurrencyId: setup.usd.currencyKey,
      skipMaintenance: true,
      transactionDate: new Date(`${day}T00:00:00Z`),
      unitPrice,
      ...extra,
    }, setup.em);

  const buy = (appuser: Appuser, day: string, quantity: number, unitPrice: number, extra: Record<string, unknown> = {}) =>
    trade(appuser, FINANCIAL_TRANSACTION_TYPES.BUY, day, quantity, unitPrice, extra);
  const sell = (appuser: Appuser, day: string, quantity: number, unitPrice: number, extra: Record<string, unknown> = {}) =>
    trade(appuser, FINANCIAL_TRANSACTION_TYPES.SELL, day, quantity, unitPrice, extra);

  const holding = async () => {
    const holdings = await portfolioHoldingsService.getPortfolioHoldings(setup.appuser, setup.portfolio.portfolioKey, household.tenant.tenantKey);
    return holdings.find((candidate) => candidate.financialAssetKey === setup.asset.financialAssetKey);
  };

  const realized = () =>
    portfolioHoldingsService.getRealizedGains(setup.appuser.appuserKey, setup.portfolio.portfolioKey, household.tenant.tenantKey);

  it('relieves the running average under AVERAGE and leaves the average unchanged', async () => {
    await useRate(1);
    await setMethod(PortfolioCostBasisMethod.AVERAGE);
    await buy(setup.appuser, '2026-07-17', 10, 100);
    await buy(setup.appuser, '2026-07-18', 10, 200);
    await sell(setup.appuser, '2026-07-19', 10, 250);

    await expect(holding()).resolves.toMatchObject({ averageBuyPrice: 150, quantity: 10 });
    await expect(realized()).resolves.toMatchObject({ totalCostBasisOfSold: 1500, totalRealizedGains: 1000 });
  });

  it('keeps FIFO for a portfolio that never chose a method', async () => {
    await useRate(1);
    await buy(setup.appuser, '2026-07-17', 10, 100);
    await buy(setup.appuser, '2026-07-18', 10, 200);
    await sell(setup.appuser, '2026-07-19', 10, 250);

    await expect(holding()).resolves.toMatchObject({ averageBuyPrice: 200, quantity: 10 });
    await expect(realized()).resolves.toMatchObject({ totalCostBasisOfSold: 1000, totalRealizedGains: 1500 });
  });

  it("pools a household's rows from both members", async () => {
    await useRate(1);
    await setMethod(PortfolioCostBasisMethod.AVERAGE);
    await buy(setup.appuser, '2026-07-17', 10, 100, { tenantId: household.tenant.tenantKey });
    await buy(partner, '2026-07-18', 10, 200, { tenantId: household.tenant.tenantKey });
    await sell(setup.appuser, '2026-07-19', 10, 250, { tenantId: household.tenant.tenantKey });

    await expect(holding()).resolves.toMatchObject({ averageBuyPrice: 150, quantity: 10 });
    await expect(realized()).resolves.toMatchObject({ totalCostBasisOfSold: 1500, totalRealizedGains: 1000 });
  });

  it('converts a fee paid in another currency into the pool', async () => {
    // The first buy's 5 USD fee is 4.50 EUR at 0.9; its 100 USD unit price is 90 EUR.
    await useRate(0.9);
    await setMethod(PortfolioCostBasisMethod.AVERAGE);
    await buy(setup.appuser, '2026-07-17', 10, 100, { feeAmount: 5, feeCurrencyId: setup.usd.currencyKey });
    await buy(setup.appuser, '2026-07-18', 10, 200);
    await sell(setup.appuser, '2026-07-19', 10, 250);

    // (900 + 4.50 + 1800) / 20 = 135.225 per unit; the sale relieves half of it.
    await expect(holding()).resolves.toMatchObject({ averageBuyPrice: 135.225, quantity: 10 });
    await expect(realized()).resolves.toMatchObject({ totalCostBasisOfSold: 1352.25 });
  });

  it("reads each portfolio's own method in the aggregate holdings read", async () => {
    await useRate(1);
    // A second portfolio, with its own asset, on average cost.
    const stockType = await DI.em.findOneOrFail(FinancialAssetType, { name: 'Stock' });
    const bond = DI.em.create(FinancialAsset, {
      currencyKey: household.currency,
      financialAssetTypeKey: stockType,
      name: 'Bond Fund',
      symbol: 'BOND',
    }, { partial: true });
    await DI.em.flush();
    const averagePortfolio = DI.em.create(Portfolio, {
      costBasisMethod: PortfolioCostBasisMethod.AVERAGE,
      currencyKey: household.currency,
      name: 'Average',
      portfolioOwnerAppuserKey: setup.appuser,
      tenantKey: household.tenant,
    }, { partial: true });
    await DI.em.flush();

    const tradeOn = (portfolioId: number, asset: FinancialAsset, type: number, day: string, quantity: number, unitPrice: number) =>
      portfolioTransactionService.createPortfolioTransaction(setup.appuser, {
        assetSymbol: asset.symbol,
        financialAsset: asset,
        financialTransactionTypeId: type,
        portfolioId,
        quantity,
        settlementCurrencyId: household.currency.currencyKey,
        skipMaintenance: true,
        transactionDate: new Date(`${day}T00:00:00Z`),
        unitPrice,
      }, setup.em);

    // FIFO portfolio: the oldest lot goes, 200 remains.
    await tradeOn(setup.portfolio.portfolioKey, setup.asset, FINANCIAL_TRANSACTION_TYPES.BUY, '2026-07-17', 10, 100);
    await tradeOn(setup.portfolio.portfolioKey, setup.asset, FINANCIAL_TRANSACTION_TYPES.BUY, '2026-07-18', 10, 200);
    await tradeOn(setup.portfolio.portfolioKey, setup.asset, FINANCIAL_TRANSACTION_TYPES.SELL, '2026-07-19', 10, 250);
    // AVERAGE portfolio: the pool keeps 150.
    await tradeOn(averagePortfolio.portfolioKey, bond, FINANCIAL_TRANSACTION_TYPES.BUY, '2026-07-17', 10, 100);
    await tradeOn(averagePortfolio.portfolioKey, bond, FINANCIAL_TRANSACTION_TYPES.BUY, '2026-07-18', 10, 200);
    await tradeOn(averagePortfolio.portfolioKey, bond, FINANCIAL_TRANSACTION_TYPES.SELL, '2026-07-19', 10, 250);

    const holdings = await portfolioHoldingsService.getPortfoliosHoldings(setup.appuser, household.tenant.tenantKey);

    expect(holdings.find((candidate) => candidate.financialAssetKey === setup.asset.financialAssetKey)).toMatchObject({ averageBuyPrice: 200, quantity: 10 });
    expect(holdings.find((candidate) => candidate.financialAssetKey === bond.financialAssetKey)).toMatchObject({ averageBuyPrice: 150, quantity: 10 });
  });
});
