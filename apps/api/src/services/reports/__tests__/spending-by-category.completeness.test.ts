import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addAccount, addCategory, addPartner, addTransaction, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import type { Appuser } from '@entity/Appuser';
import type { Category } from '@entity/Category';
import type { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { FxStatus, type Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';
import { getSpendingByCategoryReport } from '@service/reports/spendingByCategory.service';
import { setTransactionSplits } from '@service/transaction/transaction-split.service';
import { reportFiltersSchema } from '@validators/reports';

/*
 * Spending by category leaves out an expense it cannot value in the viewer's currency, and says
 * so in `completeness`. An expense stored with no converted amount (`fxStatus` `missing`: no rate
 * existed when it was written) is counted there with the same filters as the total: never an
 * income, a transfer, a row outside the category filter or a row only in categories that are not
 * spending. A split counts its transaction once, however many lines it has.
 *
 * The household: the owner keeps EUR, the partner USD (1 USD = 0.8 EUR). Owner groceries -100 EUR,
 * partner groceries -220 USD, and a partner payment of -50 USD stored with no converted amount.
 */
describe('spending by category: expenses with no converted amount', () => {
  const db = useTestDatabase();
  const july = (day: number) => new Date(Date.UTC(2025, 6, day, 12));
  const RANGE = { fromDate: '2025-07-01T00:00:00Z', toDate: '2025-07-31T23:59:59Z' };

  async function addRate(em: EntityManager, from: Currency, to: Currency, rate: number) {
    em.create(ExchangeRate, { date: new Date('2025-06-30T00:00:00Z'), fromCurrency: from, rate, toCurrency: to }, { partial: true });
    await em.flush();
  }

  async function mixedHousehold() {
    const em = db.em();
    const household = await seedHousehold(em);
    const usd = await currencyFor(em, 'USD');
    const partner = await addPartner(em, household, { currency: usd });
    const partnerAccount = await addAccount(em, household, { currency: usd, name: 'Checking', owner: partner });
    await addRate(em, usd, household.currency, 0.8);
    await addRate(em, household.currency, usd, 1.25);
    const groceries = await addCategory(em, household, 'Groceries');
    const dining = await addCategory(em, household, 'Dining');
    await addTransaction(em, household, { amount: -100, category: groceries, date: july(5), status: 'BOOKED' });
    await addTransaction(em, household, { account: partnerAccount, amount: -220, appuser: partner, category: groceries, currency: usd, date: july(6), status: 'BOOKED' });

    /** A partner row in USD stored with no converted amount, as the sync writes one with no rate. */
    const addMissing = async (input: { amount: number; category?: Category; type?: TransactionType }): Promise<Transaction> => {
      const row = await addTransaction(em, household, { account: partnerAccount, appuser: partner, currency: usd, date: july(8), status: 'BOOKED', ...input });
      row.appuserSettlementAmount = null;
      row.fxStatus = FxStatus.MISSING;
      await em.flush();
      return row;
    };
    return { addMissing, dining, em, groceries, household, partner };
  }

  const report = (household: Household, viewer: Appuser, filters: Record<string, unknown> = {}) =>
    getSpendingByCategoryReport({ filters: reportFiltersSchema.parse({ ...RANGE, ...filters }), tenant: household.tenant, user: viewer });

  it('counts an expense with no converted amount and leaves it out of the totals', async () => {
    const { addMissing, groceries, household } = await mixedHousehold();
    await addMissing({ amount: -50, category: groceries });

    const result = await report(household, household.appuser);

    // 100 EUR + 220 USD at 0.8.
    expect(result.data).toEqual([expect.objectContaining({ name: 'Groceries', totalAmount: 276, transactionCount: 2 })]);
    expect(result.completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
  });

  it('counts it for the partner too', async () => {
    const { addMissing, groceries, household, partner } = await mixedHousehold();
    await addMissing({ amount: -50, category: groceries });

    const result = await report(household, partner);

    // 100 EUR at 1.25 + 220 USD.
    expect(result.data).toEqual([expect.objectContaining({ totalAmount: 345, transactionCount: 2 })]);
    expect(result.completeness).toEqual({ currencyCode: 'USD', isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
  });

  it('counts an uncategorized expense with no converted amount', async () => {
    const { addMissing, household } = await mixedHousehold();
    await addMissing({ amount: -50 });

    const result = await report(household, household.appuser);

    expect(result.completeness).toMatchObject({ isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
  });

  it('counts a split transaction with no converted amount once', async () => {
    const { addMissing, dining, groceries, household, partner } = await mixedHousehold();
    const split = await addMissing({ amount: -50, category: groceries });
    await setTransactionSplits(db.em(), { appuserKey: partner.appuserKey, tenantKey: household.tenant.tenantKey }, split.transactionKey, [
      { amount: -30, categoryKey: groceries.categoryKey },
      { amount: -20, categoryKey: dining.categoryKey },
    ]);

    const result = await report(household, household.appuser);

    expect(result.data.map((row) => row.name)).toEqual(['Groceries']);
    expect(result.completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
  });

  it('counts a split with no converted amount when only one of its lines passes the category filter', async () => {
    const { addMissing, dining, groceries, household, partner } = await mixedHousehold();
    const split = await addMissing({ amount: -50, category: groceries });
    await setTransactionSplits(db.em(), { appuserKey: partner.appuserKey, tenantKey: household.tenant.tenantKey }, split.transactionKey, [
      { amount: -30, categoryKey: groceries.categoryKey },
      { amount: -20, categoryKey: dining.categoryKey },
    ]);

    const result = await report(household, household.appuser, { categoryKeys: [String(dining.categoryKey)] });

    expect(result.data).toEqual([]);
    expect(result.completeness).toMatchObject({ isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
  });

  it('does not count rows the total would not count either', async () => {
    const { addMissing, dining, em, groceries, household } = await mixedHousehold();
    const investments = await addCategory(em, household, 'Investments and savings');
    investments.countsAsSpending = false;
    await em.flush();
    const transferOut = (await em.findOne(TransactionType, { name: 'TRANSFER_OUT' })) ?? em.create(TransactionType, { displayName: 'Transfer out', name: 'TRANSFER_OUT' }, { partial: true });
    await em.flush();

    // Money in, a transfer, a category that is not spending, and one outside the filter.
    await addMissing({ amount: 80, category: groceries });
    await addMissing({ amount: -60, category: groceries, type: transferOut });
    await addMissing({ amount: -40, category: investments });
    await addMissing({ amount: -30, category: dining });

    const result = await report(household, household.appuser, { categoryKeys: [String(groceries.categoryKey)] });

    expect(result.data).toEqual([expect.objectContaining({ name: 'Groceries', totalAmount: 276 })]);
    expect(result.completeness).toEqual({ currencyCode: 'EUR', isComplete: true, unconvertedCurrencies: [], unconvertedTransactions: 0 });
  });
});
