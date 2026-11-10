import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
vi.mock('@service/portfolio/stock-split-sync.service', async (importOriginal) => ({ ...(await importOriginal<object>()), syncStockSplitsForAsset: vi.fn() }));
vi.mock('@service/portfolio/portfolio-snapshot.service', () => ({ default: { backfillSnapshotsForPortfolio: vi.fn() } }));
vi.mock('@service/portfolio/historical-asset-price-backfill-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  default: { trigger: vi.fn() },
}));
vi.mock('@service/portfolio/asset-price.service', async (importOriginal) => {
  const original = (await importOriginal<{ default: object }>()).default;
  return { default: Object.assign(Object.create(original) as object, { ensureRecentAssetPrice: vi.fn() }) };
});

import { addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import type { Appuser } from '@entity/Appuser';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { Portfolio } from '@entity/Portfolio';
import portfolioRoutes from '@route/portfolio';

/*
 * Portfolios belong to the household. A partner may add, edit and delete transactions on the
 * other member's portfolio, rename it and delete it, as with the household's accounts. Another
 * household gets 404 and the portfolio is left as it was.
 */
describe('portfolio writes by household members', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  // Request paths carry a job transport; the post-write maintenance it drives is stubbed above.
  const withEnqueue = express.Router();
  withEnqueue.use((req, _res, next) => {
    req.enqueue = { send: vi.fn().mockResolvedValue('job'), sendAfter: vi.fn().mockResolvedValue('job') };
    next();
  });
  withEnqueue.use(portfolioRoutes);
  const http = tenantHttp('/v1/portfolio', withEnqueue);

  let household: Household;
  let outsider: Appuser;
  let partner: Appuser;
  let portfolioKey: number;

  beforeEach(async () => {
    household = await seedHousehold(db.em());
    partner = await addPartner(db.em(), household);
    outsider = (await seedHousehold(db.em())).appuser;
    portfolioKey = (await seedPortfolio(db.em(), household)).portfolio.portfolioKey;
  });

  const buyBody = () => ({
    assetSymbol: 'AAPL',
    financialTransactionTypeId: FINANCIAL_TRANSACTION_TYPES.BUY,
    quantity: 2,
    settlementCurrencyId: household.currency.currencyKey,
    transactionDate: '2026-07-17',
    unitPrice: 100,
  });
  const storedTransactions = () => db.em().find(FinancialTransaction, {}, { filters: false, orderBy: { transactionKey: 'ASC' } });
  const storedPortfolio = () => db.em().findOneOrFail(Portfolio, { portfolioKey }, { filters: false });

  async function ownerBuy(): Promise<number> {
    expect((await http.as(household.appuser).post(`/v1/portfolio/${portfolioKey}/transaction`).send(buyBody())).status).toBe(201);
    const [buy] = await storedTransactions();
    return buy!.transactionKey;
  }

  describe('transactions', () => {
    it("lets the partner add, edit and delete a transaction on the owner's portfolio", async () => {
      expect((await http.as(partner).post(`/v1/portfolio/${portfolioKey}/transaction`).send(buyBody())).status).toBe(201);
      const [created] = await storedTransactions();
      expect(created).toBeDefined();

      expect((await http.as(partner).put(`/v1/portfolio/${portfolioKey}/transaction/${created!.transactionKey}`).send({ notes: 'rebalanced' })).status).toBe(200);
      expect((await storedTransactions())[0]!.notes).toBe('rebalanced');

      expect((await http.as(partner).delete(`/v1/portfolio/${portfolioKey}/transaction/${created!.transactionKey}`)).status).toBe(204);
      expect((await storedTransactions())[0]!.deletedAt).toBeInstanceOf(Date);
    });

    it("returns 404 to another household for adding, editing or deleting and leaves the portfolio's rows alone", async () => {
      const transactionKey = await ownerBuy();

      expect((await http.as(outsider).post(`/v1/portfolio/${portfolioKey}/transaction`).send(buyBody())).status).toBe(404);
      expect((await http.as(outsider).put(`/v1/portfolio/${portfolioKey}/transaction/${transactionKey}`).send({ notes: 'taken over' })).status).toBe(404);
      expect((await http.as(outsider).delete(`/v1/portfolio/${portfolioKey}/transaction/${transactionKey}`)).status).toBe(404);

      const rows = await storedTransactions();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ deletedAt: null });
      expect(rows[0]!.notes).toBeFalsy();
    });
  });

  describe('the portfolio itself', () => {
    it("lets the partner rename and delete the owner's portfolio", async () => {
      expect((await http.as(partner).put(`/v1/portfolio/${portfolioKey}`).send({ name: 'Ours now' })).status).toBe(200);
      await expect(storedPortfolio()).resolves.toMatchObject({ name: 'Ours now' });

      expect((await http.as(partner).delete(`/v1/portfolio/${portfolioKey}`)).status).toBe(204);
      expect((await storedPortfolio()).deletedAt).toBeInstanceOf(Date);
    });

    it('returns 404 to another household for renaming or deleting it', async () => {
      expect((await http.as(outsider).put(`/v1/portfolio/${portfolioKey}`).send({ name: 'Taken over' })).status).toBe(404);
      expect((await http.as(outsider).delete(`/v1/portfolio/${portfolioKey}`)).status).toBe(404);

      await expect(storedPortfolio()).resolves.toMatchObject({ deletedAt: null, name: 'Shares' });
    });
  });
});
