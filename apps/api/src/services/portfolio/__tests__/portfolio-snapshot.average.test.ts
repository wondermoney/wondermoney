import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { addAssetPrice, addExchangeRate, type PortfolioSetup, seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { PortfolioCostBasisMethod } from '@app/constants/portfolio-cost-basis';
import { DI } from '@app/database/di';
import { Portfolio } from '@entity/Portfolio';
import { PortfolioSnapshot } from '@entity/PortfolioSnapshot';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../stock-split-sync.service', async (importOriginal) => ({ ...(await importOriginal<object>()), syncStockSplitsForAsset: vi.fn() }));

import portfolioSnapshotService from '../portfolio-snapshot.service';
import portfolioTransactionService from '../portfolio-transaction.service';

/*
 * The daily snapshot replays trades itself (it needs a value for every day, not only today).
 * A sale must relieve cost under the portfolio's method there too, or the history would
 * disagree with the holdings and realized gains the same portfolio shows.
 */
describe('portfolio snapshot cost basis method', () => {
  const db = useTestDatabase();
  let household: Household;
  let setup: PortfolioSetup;

  beforeEach(async () => {
    household = await seedHousehold(db.em());
    setup = await seedPortfolio(db.em(), household);
    await addExchangeRate(DI.em, setup.usd, household.currency, '2026-07-17', 1);
  });

  const trade = (type: number, day: string, quantity: number, unitPrice: number) =>
    portfolioTransactionService.createPortfolioTransaction(setup.appuser, {
      assetSymbol: setup.asset.symbol,
      financialAsset: setup.asset,
      financialTransactionTypeId: type,
      portfolioId: setup.portfolio.portfolioKey,
      quantity,
      settlementCurrencyId: setup.usd.currencyKey,
      skipMaintenance: true,
      transactionDate: new Date(`${day}T00:00:00Z`),
      unitPrice,
    }, setup.em);

  const snapshotOn = async (day: string) => {
    const snapshots = await db.em().find(
      PortfolioSnapshot,
      { portfolioKey: { portfolioKey: setup.portfolio.portfolioKey } },
      { filters: false, orderBy: { snapshotDate: 'ASC' } },
    );
    return snapshots.find((snapshot) => snapshot.snapshotDate.toISOString().slice(0, 10) === day);
  };

  const seedHistory = async () => {
    await trade(FINANCIAL_TRANSACTION_TYPES.BUY, '2026-07-17', 10, 100);
    await trade(FINANCIAL_TRANSACTION_TYPES.BUY, '2026-07-18', 10, 200);
    await trade(FINANCIAL_TRANSACTION_TYPES.SELL, '2026-07-19', 10, 250);
    for (const [day, price] of [['2026-07-17', 100], ['2026-07-18', 200], ['2026-07-19', 250]] as const) {
      await addAssetPrice(DI.em, setup.asset, day, price);
    }
  };

  it('relieves the running average in the daily snapshots under AVERAGE', async () => {
    await DI.em.nativeUpdate(Portfolio, { portfolioKey: setup.portfolio.portfolioKey }, { costBasisMethod: PortfolioCostBasisMethod.AVERAGE });
    await seedHistory();

    await portfolioSnapshotService.backfillSnapshotsForPortfolio(
      setup.portfolio.portfolioKey,
      new Date('2026-07-17T00:00:00Z'),
      new Date('2026-07-19T00:00:00Z'),
    );

    // 10 units left at the 150 average: 1,500, not FIFO's 2,000.
    await expect(snapshotOn('2026-07-19')).resolves.toMatchObject({ costBasis: 1500, totalValue: 2500 });
  });

  it('keeps FIFO cost basis in the daily snapshots for a FIFO portfolio', async () => {
    await seedHistory();

    await portfolioSnapshotService.backfillSnapshotsForPortfolio(
      setup.portfolio.portfolioKey,
      new Date('2026-07-17T00:00:00Z'),
      new Date('2026-07-19T00:00:00Z'),
    );

    // The oldest lot is gone; the newer 200 lot remains: 2,000.
    await expect(snapshotOn('2026-07-19')).resolves.toMatchObject({ costBasis: 2000, totalValue: 2500 });
  });
});
