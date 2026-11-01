import { startOfMonth } from 'date-fns';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { addCategory, addTransaction, type Household, ONE_OF_EACH_STATUS, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import { getAccountsCashflow } from '../cashflow';
import { getAccountMetrics, getAccountsMetrics } from '../metrics';
import { getRecentTransactions } from '../recent-transactions';
import { getCategorySpending } from '../transactions';

type Handler = (req: Request, res: Response, next: () => void) => Promise<unknown>;

async function call(handler: Handler, household: Household, request: { params?: Record<string, string>; query?: Record<string, string> } = {}) {
  let body: unknown;
  const res = { json: (payload: unknown) => { body = payload; return res; }, sendStatus: vi.fn(), status: vi.fn(() => res) } as unknown as Response;
  const req = { body: {}, headers: {}, params: request.params ?? {}, query: request.query ?? {}, tenant: household.tenant, user: household.appuser } as unknown as Request;
  await handler(req, res, () => undefined);
  return body as Record<string, unknown>;
}

/*
 * EXPIRED rows are money that never moved (a dropped pending, or a payment the bank rejected or
 * cancelled). Every account aggregate leaves them out. PENDING keeps the treatment it already had
 * on each path, and a row with no status at all (legacy) still counts.
 */
describe('account aggregates and transaction status', () => {
  const db = useTestDatabase();
  const inThisMonth = () => new Date(startOfMonth(new Date()).getTime() + 12 * 60 * 60 * 1000);

  async function seedOneOfEach() {
    const em = db.em();
    const household = await seedHousehold(em);
    const groceries = await addCategory(em, household, 'Groceries', await addCategory(em, household, 'Food'));
    for (const status of ONE_OF_EACH_STATUS) {
      await addTransaction(em, household, { amount: -10, category: groceries, date: inThisMonth(), status });
    }
    return household;
  }

  it('leaves expired rows out of the all-accounts metrics', async () => {
    const household = await seedOneOfEach();

    const body = await call(getAccountsMetrics as Handler, household);

    expect(body['metrics']).toEqual([expect.objectContaining({ outflowCurrentPeriod: 30, transactionCountCurrentPeriod: 3 })]);
  });

  it('leaves expired rows out of a single account\'s metrics', async () => {
    const household = await seedOneOfEach();

    const body = await call(getAccountMetrics as Handler, household, { params: { accountId: String(household.account.accountKey) } });

    expect(body['metrics']).toEqual([expect.objectContaining({ outflowCurrentPeriod: 30, transactionCountCurrentPeriod: 3 })]);
  });

  it('still reports an account whose only rows are expired, with zero activity', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await addTransaction(em, household, { amount: -10, date: inThisMonth(), status: 'EXPIRED' });

    const body = await call(getAccountsMetrics as Handler, household);

    expect(body['metrics']).toEqual([expect.objectContaining({ accountKey: household.account.accountKey, outflowCurrentPeriod: 0, transactionCountCurrentPeriod: 0 })]);
  });

  it('leaves expired rows out of the monthly cashflow', async () => {
    const household = await seedOneOfEach();

    const body = await call(getAccountsCashflow as Handler, household);

    expect(body['cashflow']).toEqual([expect.objectContaining({ amount: -30 })]);
  });

  it('leaves expired rows out of category spending', async () => {
    const household = await seedOneOfEach();

    const body = await call(getCategorySpending as Handler, household);

    expect(body['categorySpending']).toEqual([
      expect.objectContaining({ amount: 30, childCategories: [expect.objectContaining({ amount: 30, name: 'Groceries', numTransactions: 3 })], name: 'Food', numTransactions: 3 }),
    ]);
  });

  it('leaves expired rows out of an account\'s recent transactions', async () => {
    const household = await seedOneOfEach();

    const body = await call(getRecentTransactions as Handler, household, { params: { accountId: String(household.account.accountKey) } });

    expect(body['transactions']).toHaveLength(3);
  });
});
