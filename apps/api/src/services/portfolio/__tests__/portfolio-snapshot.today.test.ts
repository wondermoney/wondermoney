import { describe, expect, it, vi } from 'vitest';

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { addAssetPrice, addExchangeRate, seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { DI } from '@app/database/di';
import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../stock-split-sync.service', async (importOriginal) => ({ ...(await importOriginal<object>()), syncStockSplitsForAsset: vi.fn() }));
vi.mock('../asset-price.service', async (importOriginal) => {
  const original = (await importOriginal<{ default: object }>()).default;
  return { default: Object.assign(Object.create(original) as object, { ensureRecentAssetPrice: vi.fn() }) };
});

import { NetWorthService } from '@service/net-worth/net-worth.service';

import portfolioSnapshotService from '../portfolio-snapshot.service';
import portfolioTransactionService from '../portfolio-transaction.service';

/*
 * The daily snapshot is what net worth reads for a portfolio. A dollar portfolio held by a euro
 * user is worth its dollar value at the latest dollar-to-euro rate, converted once.
 */
describe('today\'s portfolio snapshot in net worth', () => {
  const db = useTestDatabase();
  const ymd = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

  async function dollarPortfolio(rateDay: string) {
    const household = await seedHousehold(db.em());
    const { appuser, asset, em, portfolio, usd } = await seedPortfolio(DI.em, household, { portfolioCurrency: 'USD' });
    await em.nativeUpdate(Account, { accountKey: household.account.accountKey }, { appuserCurrencyBalance: 0, balance: 0 });
    await addExchangeRate(em, usd, household.currency, '2026-07-17', 0.9);
    if (rateDay !== '2026-07-17') await addExchangeRate(em, usd, household.currency, rateDay, 0.9);
    await addAssetPrice(em, asset, ymd(-1), 110);
    await portfolioTransactionService.createPortfolioTransaction(appuser, {
      assetSymbol: asset.symbol, financialAsset: asset, financialTransactionTypeId: FINANCIAL_TRANSACTION_TYPES.BUY, portfolioId: portfolio.portfolioKey,
      quantity: 10, settlementCurrencyId: usd.currencyKey, skipMaintenance: true, transactionDate: new Date('2026-07-17T00:00:00Z'), unitPrice: 100,
    }, em);
    return { household, portfolio };
  }

  async function netWorthPortfolios(appuserKey: number) {
    const appuser = await DI.em.findOneOrFail(Appuser, { appuserKey }, { filters: false });
    return (await new NetWorthService().getNetWorth(appuser)).assets.portfolios;
  }

  it('converts the portfolio value to the user currency once', async () => {
    const { household, portfolio } = await dollarPortfolio(ymd(0));

    await portfolioSnapshotService.updateSnapshotForToday(portfolio.portfolioKey);

    // 10 shares at $110 is $1,100, which is €990 at 0.9.
    await expect(netWorthPortfolios(household.appuser.appuserKey)).resolves.toBe(990);
  });

  it('values the portfolio on a day with no new exchange rate', async () => {
    const { household, portfolio } = await dollarPortfolio(ymd(-3));

    await portfolioSnapshotService.updateSnapshotForToday(portfolio.portfolioKey);

    await expect(netWorthPortfolios(household.appuser.appuserKey)).resolves.toBe(990);
  });
});
