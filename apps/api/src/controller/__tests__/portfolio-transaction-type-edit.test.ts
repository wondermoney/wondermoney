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

import { type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import portfolioRoutes from '@route/portfolio';
import { TRANSACTION_TYPE_CHANGE_MESSAGE } from '@service/portfolio/portfolio-transaction.service';

/*
 * An edit may switch a trade between buy and sell, never a trade into a dividend or back:
 * quantity and unit price mean different things on each. The client gets a 400 that says so,
 * and the row stays as it was.
 */
describe('editing the type of a portfolio transaction over HTTP', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const withEnqueue = express.Router();
  withEnqueue.use((req, _res, next) => {
    req.enqueue = { send: vi.fn().mockResolvedValue('job'), sendAfter: vi.fn().mockResolvedValue('job') };
    next();
  });
  withEnqueue.use(portfolioRoutes);
  const http = tenantHttp('/v1/portfolio', withEnqueue);

  let household: Household;
  let portfolioKey: number;

  beforeEach(async () => {
    household = await seedHousehold(db.em());
    portfolioKey = (await seedPortfolio(db.em(), household)).portfolio.portfolioKey;
  });

  async function record(financialTransactionTypeId: number): Promise<FinancialTransaction> {
    const response = await http.as(household.appuser).post(`/v1/portfolio/${portfolioKey}/transaction`).send({
      assetSymbol: 'AAPL',
      financialTransactionTypeId,
      quantity: 2,
      settlementCurrencyId: household.currency.currencyKey,
      transactionDate: '2026-07-17',
      unitPrice: 100,
    });
    expect(response.status).toBe(201);
    return db.em().fork().findOneOrFail(FinancialTransaction, { portfolioKey: { portfolioKey } }, { filters: false, orderBy: { transactionKey: 'DESC' }, populate: ['financialTransactionTypeKey'] });
  }

  const stored = (transactionKey: number) =>
    db.em().fork().findOneOrFail(FinancialTransaction, { transactionKey }, { filters: false, populate: ['financialTransactionTypeKey'] });

  it.each([
    { from: 'BUY', to: 'DIVIDEND' },
    { from: 'DIVIDEND', to: 'SELL' },
  ] as const)('answers a $from changed into a $to with a 400 that explains why', async ({ from, to }) => {
    const row = await record(FINANCIAL_TRANSACTION_TYPES[from]);

    const response = await http.as(household.appuser).put(`/v1/portfolio/${portfolioKey}/transaction/${row.transactionKey}`).send({
      financialTransactionTypeId: FINANCIAL_TRANSACTION_TYPES[to],
      quantity: 2,
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'bad_request', message: TRANSACTION_TYPE_CHANGE_MESSAGE });
    const after = await stored(row.transactionKey);
    expect(after.financialTransactionTypeKey?.name).toBe(from);
    expect(after.quantity).toBe(row.quantity);
  });
});
