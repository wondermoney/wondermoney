import { describe, expect, it, vi } from 'vitest';

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { addAssetPrice, addExchangeRate, seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { DI } from '@app/database/di';
import { FinancialTransaction } from '@entity/FinancialTransaction';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../stock-split-sync.service', async (importOriginal) => ({ ...(await importOriginal<object>()), syncStockSplitsForAsset: vi.fn() }));
vi.mock('../asset-price.service', async (importOriginal) => {
  const original = (await importOriginal<{ default: object }>()).default;
  return { default: Object.assign(Object.create(original) as object, { ensureRecentAssetPrice: vi.fn() }) };
});

import portfolioHoldingsService from '../portfolio-holdings.service';
import portfolioTransactionService from '../portfolio-transaction.service';

/*
 * A holding's cost is in the user's currency: a purchase settled in another currency is converted
 * at the rate of its trade date. ECB rates are published for business days at midnight UTC, so a
 * trade at any time of day, or on a weekend, converts at the latest rate published by then.
 */
describe('portfolio cost basis in the user currency', () => {
  const db = useTestDatabase();

  async function setup() {
    const household = await seedHousehold(db.em());
    const setup = await seedPortfolio(DI.em, household);
    await addExchangeRate(setup.em, setup.usd, household.currency, '2026-07-17', 0.9);
    await addAssetPrice(setup.em, setup.asset, '2026-07-20', 100);
    const buy = (transactionDate: Date, settlementCurrencyId = setup.usd.currencyKey) => portfolioTransactionService.createPortfolioTransaction(setup.appuser, {
      assetSymbol: setup.asset.symbol, financialAsset: setup.asset, financialTransactionTypeId: FINANCIAL_TRANSACTION_TYPES.BUY, portfolioId: setup.portfolio.portfolioKey,
      quantity: 10, settlementCurrencyId, skipMaintenance: true, transactionDate, unitPrice: 100,
    }, setup.em);
    const averageBuyPrice = async () => {
      const [holding] = await portfolioHoldingsService.getPortfolioHoldings(setup.appuser, setup.portfolio.portfolioKey, household.tenant.tenantKey);
      return holding?.averageBuyPrice;
    };
    return { ...setup, averageBuyPrice, buy, household };
  }

  it.each([
    ['at midnight UTC on a business day', '2026-07-17T00:00:00Z'],
    ['during the day', '2026-07-17T14:30:00Z'],
    ['on a weekend', '2026-07-18T10:00:00Z'],
  ])('converts a dollar purchase made %s', async (_label, tradedAt) => {
    const { averageBuyPrice, buy } = await setup();

    await buy(new Date(tradedAt));

    // $100 a share at 0.9 is €90.
    await expect(averageBuyPrice()).resolves.toBe(90);
  });

  it('stops converting a purchase whose settlement currency is changed to the user currency', async () => {
    const { appuser, averageBuyPrice, buy, em, household, portfolio } = await setup();
    await buy(new Date('2026-07-17T00:00:00Z'));
    const [stored] = await em.find(FinancialTransaction, {});

    await portfolioTransactionService.updatePortfolioTransaction(appuser, portfolio.portfolioKey, stored!.transactionKey, { settlementCurrencyId: household.currency.currencyKey }, { enqueue: { send: vi.fn(), sendAfter: vi.fn() } });

    // Now €100 a share, as entered.
    await expect(averageBuyPrice()).resolves.toBe(100);
  });
});
