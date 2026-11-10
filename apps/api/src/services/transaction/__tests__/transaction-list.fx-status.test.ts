import { describe, expect, it, vi } from 'vitest';

import { addTransaction, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { ExchangeRate } from '@entity/ExchangeRate';
import { FxStatus, Transaction } from '@entity/Transaction';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { listTransactions } from '../transaction-list.service';

/*
 * A row converted without a current rate must not read like any other: the list says how each
 * row was converted, so a client can show the original amount of a row that has no converted one
 * and mark a row converted at an old rate as estimated, with the date of that rate.
 */
describe('transaction list and how each row was converted', () => {
  const db = useTestDatabase();

  const list = (household: Household) =>
    listTransactions({ filters: {}, limit: 50, scope: 'all-accounts', tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });

  async function aForeignRow(household: Household, input: { amount: null | number; date: Date; fxStatus: FxStatus | null }) {
    const em = db.em();
    const jpy = await currencyFor(em, 'JPY');
    const row = await addTransaction(em, household, { amount: -10_000, date: input.date, status: null });
    const stored = await em.findOneOrFail(Transaction, { transactionKey: row.transactionKey }, { filters: false });
    stored.settlementCurrencyKey = jpy;
    stored.appuserSettlementAmount = input.amount;
    stored.fxStatus = input.fxStatus;
    await em.flush();
    return { jpy, row };
  }

  it('marks a row with no converted amount as missing', async () => {
    const household = await seedHousehold(db.em());
    await aForeignRow(household, { amount: null, date: new Date(Date.UTC(2026, 6, 10)), fxStatus: FxStatus.MISSING });

    const page = await list(household);

    expect(page.transactions[0]).toMatchObject({ appuserSettlementAmount: null, fxRateDate: null, fxStatus: 'missing', settlementAmount: -10_000 });
  });

  it('marks a legacy row with no converted amount and no status as missing too', async () => {
    const household = await seedHousehold(db.em());
    await aForeignRow(household, { amount: null, date: new Date(Date.UTC(2026, 6, 10)), fxStatus: null });

    const page = await list(household);

    expect(page.transactions[0]).toMatchObject({ fxStatus: 'missing' });
  });

  it('gives a provisional row the date of the rate it was converted at', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const { jpy } = await aForeignRow(household, { amount: -60, date: new Date(Date.UTC(2026, 6, 20)), fxStatus: FxStatus.PROVISIONAL });
    em.create(ExchangeRate, { date: new Date(Date.UTC(2026, 6, 1)), fromCurrency: jpy, rate: 0.006, toCurrency: household.currency }, { partial: true });
    em.create(ExchangeRate, { date: new Date(Date.UTC(2026, 5, 1)), fromCurrency: jpy, rate: 0.007, toCurrency: household.currency }, { partial: true });
    await em.flush();

    const page = await list(household);

    expect(page.transactions[0]).toMatchObject({ fxRateDate: '2026-07-01', fxStatus: 'provisional' });
  });

  it('marks a row in the viewer currency as exact, with no rate date', async () => {
    const household = await seedHousehold(db.em());
    await addTransaction(db.em(), household, { amount: -25, date: new Date(Date.UTC(2026, 6, 10)), status: null });

    const page = await list(household);

    expect(page.transactions[0]).toMatchObject({ fxRateDate: null, fxStatus: 'exact' });
  });
});
