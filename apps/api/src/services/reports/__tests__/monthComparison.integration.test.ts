import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/assistant/assistant-audit.service', () => ({ AssistantAuditService: { log: vi.fn() } }));

import { addAccount, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Category } from '@entity/Category';
import { TransactionAuditActorType } from '@entity/TransactionAuditLog';
import { TransactionType } from '@entity/TransactionType';
import { reconcileTransfers } from '@service/transaction/transfer-matching.service';
import { reportFiltersSchema } from '@validators/reports';

import { getCashflowReport } from '../cashflow.service';
import { getMonthComparisonReport, monthRange } from '../monthComparison.service';
import type { ReportServiceInput } from '../report-filters';
import { getSpendingByCategoryReport } from '../spendingByCategory.service';

/*
 * At the layer that adds the money up: the comparison's totals are the cash-flow
 * report's rows for the same months, and its category rows are the
 * spending-by-category report's rows for the same months. A refund is money in,
 * a transfer between own accounts is neither income nor spending, and a pending
 * row is not counted — because the reports it composes already say so.
 */
describe('month comparison agrees with the reports it composes', () => {
  const db = useTestDatabase();
  let sequence = 0;

  const TIME_ZONE = 'Europe/Lisbon';
  const AUGUST = monthRange('2026-08', TIME_ZONE);
  const JULY = monthRange('2026-07', TIME_ZONE);

  async function seed() {
    const em = db.em();
    const household = await seedHousehold(em);
    const typeNamed = async (name: string) => (await em.findOne(TransactionType, { name })) ?? em.create(TransactionType, { displayName: name, name }, { partial: true });
    const deposit = await typeNamed('DEPOSIT');
    const payment = await typeNamed('PAYMENT');
    await typeNamed('TRANSFER_IN');
    await typeNamed('TRANSFER_OUT');
    await em.flush();
    const savings = await addAccount(em, household, { name: 'Savings' });
    const category = (name: string, parentCategory?: Category) => em.create(Category, { appuserKey: household.appuser, bgColor: '#000', name, parentCategory, tenantKey: household.tenant, textColor: '#fff' }, { partial: true });
    const categories = {
      groceries: category('Groceries', category('Food')),
      rent: category('Rent', category('Home')),
      salary: category('Salary', category('Income')),
      transfers: category('Transfers', category('Transfers')),
    };
    await em.flush();

    const book = (input: { account?: typeof savings; amount: number; category: Category; date: string; status?: 'BOOKED' | 'PENDING'; type: TransactionType }) => addTransaction(em, household, {
      account: input.account,
      amount: input.amount,
      category: input.category,
      date: new Date(input.date),
      enableBankingTransactionId: `eb-${++sequence}`,
      status: input.status ?? 'BOOKED',
      type: input.type,
    });

    // July: the month compared against.
    await book({ amount: 2000, category: categories.salary, date: '2026-07-01T12:00:00Z', type: deposit });
    await book({ amount: -100, category: categories.groceries, date: '2026-07-05T12:00:00Z', type: payment });
    await book({ amount: -900, category: categories.rent, date: '2026-07-02T12:00:00Z', type: payment });

    // August: the month examined. A refund comes back into the groceries category.
    await book({ amount: 2000, category: categories.salary, date: '2026-08-01T12:00:00Z', type: deposit });
    await book({ amount: -150, category: categories.groceries, date: '2026-08-05T12:00:00Z', type: payment });
    await book({ amount: 20, category: categories.groceries, date: '2026-08-06T12:00:00Z', type: deposit });
    await book({ amount: -1000, category: categories.rent, date: '2026-08-02T12:00:00Z', type: payment });
    // A pending row, and a transfer between the household's own accounts.
    await book({ amount: -300, category: categories.groceries, date: '2026-08-20T12:00:00Z', status: 'PENDING', type: payment });
    await book({ amount: -500, category: categories.transfers, date: '2026-08-10T12:00:00Z', type: payment });
    await book({ account: savings, amount: 500, category: categories.transfers, date: '2026-08-11T12:00:00Z', type: deposit });
    await reconcileTransfers(db.em(), { actorType: TransactionAuditActorType.SYNC, apply: true, source: 'test', tenantKey: household.tenant.tenantKey });
    return { household };
  }

  const input = (household: Household, range: Partial<{ fromDate: string; toDate: string }>): ReportServiceInput => ({
    filters: reportFiltersSchema.parse({ ...range, timezone: TIME_ZONE }),
    tenant: household.tenant,
    user: household.appuser,
  });

  it('totals equal the cash-flow report for each month', async () => {
    const { household } = await seed();

    const comparison = (await getMonthComparisonReport(input(household, {}), { base: '2026-08', compare: '2026-07' })).data;
    const august = (await getCashflowReport(input(household, AUGUST))).data;
    const july = (await getCashflowReport(input(household, JULY))).data;

    expect(comparison.base).toEqual({ expenses: august[0]?.expenses, income: august[0]?.income, month: '2026-08', net: august[0]?.net, savingsRate: august[0]?.savingsRate });
    expect(comparison.compare).toEqual({ expenses: july[0]?.expenses, income: july[0]?.income, month: '2026-07', net: july[0]?.net, savingsRate: july[0]?.savingsRate });
    // The refund is money in; the pending row and the own-account transfer are neither.
    expect(comparison.base).toMatchObject({ expenses: 1150, income: 2020, net: 870 });
    expect(comparison.compare).toMatchObject({ expenses: 1000, income: 2000, net: 1000 });
  });

  it('category rows equal the spending-by-category report for each month', async () => {
    const { household } = await seed();

    const comparison = (await getMonthComparisonReport(input(household, {}), { base: '2026-08', compare: '2026-07' })).data;
    const august = (await getSpendingByCategoryReport(input(household, AUGUST))).data;
    const july = (await getSpendingByCategoryReport(input(household, JULY))).data;

    const byKey = (rows: { categoryKey: string; totalAmount: number }[]) => new Map(rows.map((row) => [row.categoryKey, row.totalAmount]));
    const augustTotals = byKey(august);
    const julyTotals = byKey(july);
    for (const row of comparison.categories) {
      expect(row.base).toBe(augustTotals.get(row.categoryKey) ?? 0);
      expect(row.compare).toBe(julyTotals.get(row.categoryKey) ?? 0);
    }
    // The refund lowers the net but is not negative spending, and the transfer is not spending at all.
    const groceries = comparison.categories.find((row) => row.name === 'Groceries');
    expect(groceries).toMatchObject({ base: 150, compare: 100, delta: 50, deltaPct: 50 });
    expect(comparison.categories.map((row) => row.name)).not.toContain('Transfers');
  });

  it('orders the categories by absolute delta', async () => {
    const { household } = await seed();

    const { categories } = (await getMonthComparisonReport(input(household, {}), { base: '2026-08', compare: '2026-07' })).data;

    const deltas = categories.map((row) => Math.abs(row.delta));
    expect(deltas).toEqual([...deltas].sort((a, b) => b - a));
    expect(categories.map((row) => row.name)).toEqual(['Rent', 'Groceries']);
  });

  it('a month with no transactions is a measured zero', async () => {
    const { household } = await seed();

    const { data } = await getMonthComparisonReport(input(household, {}), { base: '2026-08', compare: '2026-06' });

    expect(data.compare).toEqual({ expenses: 0, income: 0, month: '2026-06', net: 0, savingsRate: null });
    expect(data.categories.every((row) => row.compare === 0 && row.deltaPct === null)).toBe(true);
  });
});
