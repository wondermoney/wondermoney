import { describe, expect, it, vi } from 'vitest';

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { addExchangeRate, seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { DI } from '@app/database/di';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../stock-split-sync.service', async (importOriginal) => ({ ...(await importOriginal<object>()), syncStockSplitsForAsset: vi.fn() }));

import portfolioHoldingsService from '../portfolio-holdings.service';
import portfolioTransactionService from '../portfolio-transaction.service';

/* Dividend income is every dividend received, in the user's currency. */
describe('portfolio dividend income', () => {
  const db = useTestDatabase();

  it('counts a dividend paid in the user currency', async () => {
    const household = await seedHousehold(db.em());
    const { appuser, asset, em, portfolio } = await seedPortfolio(DI.em, household);

    await portfolioTransactionService.createPortfolioTransaction(appuser, {
      assetSymbol: asset.symbol, financialAsset: asset, financialTransactionTypeId: FINANCIAL_TRANSACTION_TYPES.DIVIDEND, portfolioId: portfolio.portfolioKey,
      quantity: 1, settlementCurrencyId: household.currency.currencyKey, skipMaintenance: true, transactionDate: new Date('2026-07-15T00:00:00Z'), unitPrice: 50,
    }, em);

    const income = await portfolioHoldingsService.getDividendIncome(household.appuser.appuserKey, undefined, household.tenant.tenantKey);

    expect(income.totalDividends).toBe(50);
    expect(income.byAsset).toEqual([expect.objectContaining({ symbol: 'AAPL', totalDividends: 50 })]);
  });

  it('adds dividends in the user currency to converted foreign ones', async () => {
    const household = await seedHousehold(db.em());
    const { appuser, asset, em, portfolio, usd } = await seedPortfolio(DI.em, household);
    await addExchangeRate(em, usd, household.currency, '2026-07-15', 0.9);
    const dividend = (unitPrice: number, settlementCurrencyId: number) => portfolioTransactionService.createPortfolioTransaction(appuser, {
      assetSymbol: asset.symbol, financialAsset: asset, financialTransactionTypeId: FINANCIAL_TRANSACTION_TYPES.DIVIDEND, portfolioId: portfolio.portfolioKey,
      quantity: 1, settlementCurrencyId, skipMaintenance: true, transactionDate: new Date('2026-07-15T00:00:00Z'), unitPrice,
    }, em);
    await dividend(50, household.currency.currencyKey);
    await dividend(100, usd.currencyKey);

    const income = await portfolioHoldingsService.getDividendIncome(household.appuser.appuserKey, undefined, household.tenant.tenantKey);

    expect(income.totalDividends).toBe(140);
  });
});
