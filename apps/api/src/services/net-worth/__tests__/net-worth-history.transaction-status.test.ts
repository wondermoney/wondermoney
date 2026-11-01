import { describe, expect, it } from 'vitest';

import { addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';

import { NetWorthService } from '../net-worth.service';

/*
 * Net-worth history reads each account's latest running balance at every point. An EXPIRED row
 * never moved money, so a balance left on one (a row stored as booked before it was retracted) is
 * never the account's balance, and its date is not a history point.
 */
describe('net-worth history and transaction status', () => {
  const db = useTestDatabase();

  it('ignores a running balance left on an expired row', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const now = new Date();
    const lastMonth = (day: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, day, 12));
    const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    await em.getConnection().execute('update "account" set "created_at" = ?, "appuser_currency_balance" = 100 where "account_key" = ?', [new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1)), household.account.accountKey]);
    await addTransaction(em, household, { amount: -10, appuserCurrencyBalance: 100, date: lastMonth(3), status: 'BOOKED' });
    await addTransaction(em, household, { amount: -50, appuserCurrencyBalance: 50, date: lastMonth(8), status: 'EXPIRED' });

    const history = await new NetWorthService().getNetWorthHistory(household.appuser, { months: 3 });

    const dates = history.points.map((point) => point.date);
    expect(dates).not.toContain(lastMonth(8).toISOString().slice(0, 10));
    expect(history.points.find((point) => point.date === lastMonthEnd.toISOString().slice(0, 10))).toMatchObject({ accountsTotal: 100 });
  });
});
