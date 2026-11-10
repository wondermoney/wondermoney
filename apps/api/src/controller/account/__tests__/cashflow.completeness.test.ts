import { startOfMonth } from 'date-fns';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { addAccount, addPartner, addTransaction, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import type { Account } from '@entity/Account';
import type { Appuser } from '@entity/Appuser';
import { FxStatus, Transaction } from '@entity/Transaction';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import { getAccountsCashflow } from '../cashflow';

type Handler = (req: Request, res: Response) => Promise<unknown>;

async function cashflowFor(household: Household, viewer: Appuser = household.appuser, query: Record<string, string> = {}) {
  let body: unknown;
  const res = { json: (payload: unknown) => { body = payload; return res; } } as unknown as Response;
  const req = { body: {}, headers: {}, params: {}, query, tenant: household.tenant, user: viewer } as unknown as Request;
  await (getAccountsCashflow as Handler)(req, res);
  return body as { cashflow: { amount: number }[]; completeness: unknown };
}

/*
 * The dashboard's monthly cash flow is summed in the user's currency. A row with no converted
 * amount cannot be added; the response counts it, and names its currency, rather than showing a
 * total that only looks complete.
 */
describe('dashboard cash flow and unconverted rows', () => {
  const db = useTestDatabase();
  const thisMonth = () => new Date(startOfMonth(new Date()).getTime() + 12 * 60 * 60 * 1000);

  async function addUnconverted(household: Household, account: Account, input: { date?: Date; hidden?: boolean } = {}) {
    const em = db.em();
    em.create(Transaction, {
      accountKey: account,
      appuserCurrencyKey: household.currency,
      appuserKey: household.appuser,
      appuserSettlementAmount: null,
      fxStatus: FxStatus.MISSING,
      hidden: input.hidden ?? false,
      settlementAmount: -25,
      settlementCurrencyKey: account.currencyKey,
      tenantKey: household.tenant,
      transactionDate: input.date ?? thisMonth(),
      transactionStatusKey: household.statuses.BOOKED,
      transactionTypeKey: household.types.cardPayment,
    }, { partial: true });
    await em.flush();
  }

  it('counts rows with no converted amount, by currency', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await addTransaction(em, household, { amount: -50, date: thisMonth(), status: 'BOOKED' });
    await addUnconverted(household, await addAccount(em, household, { currency: await currencyFor(em, 'USD') }));
    await addUnconverted(household, await addAccount(em, household, { currency: await currencyFor(em, 'JPY') }));

    const body = await cashflowFor(household);

    expect(body.cashflow).toEqual([expect.objectContaining({ amount: -50 })]);
    expect(body.completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['JPY', 'USD'], unconvertedTransactions: 2 });
  });

  it('is complete when every row was converted', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await addTransaction(em, household, { amount: -50, date: thisMonth(), status: 'BOOKED' });

    const body = await cashflowFor(household);

    expect(body.completeness).toEqual({ currencyCode: 'EUR', isComplete: true, unconvertedCurrencies: [], unconvertedTransactions: 0 });
  });

  it('only counts rows the cash flow itself would include', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const usd = await addAccount(em, household, { currency: await currencyFor(em, 'USD') });
    await addUnconverted(household, usd, { hidden: true });
    await addUnconverted(household, usd, { date: new Date('2020-01-15T12:00:00Z') });

    const body = await cashflowFor(household, household.appuser, { fromDate: '2024-01-01' });

    expect(body.completeness).toMatchObject({ isComplete: true, unconvertedTransactions: 0 });
  });

  it('does not count a partner\'s private account', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const partner = await addPartner(em, household);
    const hidden = await addAccount(em, household, { currency: await currencyFor(em, 'USD'), isPrivate: true, owner: partner });
    await addUnconverted(household, hidden);

    const body = await cashflowFor(household);

    expect(body.completeness).toMatchObject({ isComplete: true, unconvertedTransactions: 0 });
  });
});
