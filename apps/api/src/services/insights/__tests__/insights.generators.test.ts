import Big from 'big.js';
import { describe, expect, it } from 'vitest';

import type { CategorizedTransaction } from '@service/budget/aggregation-classifier';
import type { BudgetAllocationRow } from '@service/budget/aggregation-types';

import { budgetPaceInsights, generateInsights, insightId, periodKey, spendingVsNormalInsights } from '../insights.generators';
import type { SpendingBaselineMonth, SpendingVsNormalInput } from '../insights.types';

const transaction = (overrides: Partial<CategorizedTransaction> = {}): CategorizedTransaction => ({
  accountKey: 3,
  amount: new Big(100),
  categoryKey: 10,
  categoryName: 'Groceries',
  parentCategoryKey: 9,
  parentCategoryName: 'Food',
  transactionDate: new Date('2026-11-10T12:00:00Z'),
  transactionKey: 1,
  ...overrides,
});

const allocation = (overrides: Partial<BudgetAllocationRow> = {}): BudgetAllocationRow => ({
  accountClosed: false,
  accountDeleted: false,
  accountKey: 3,
  accountOwnerAppuserKey: 7,
  accountTenantKey: 11,
  amountBudgeted: '250',
  budgetKey: 1,
  budgetName: 'November plan',
  budgetTemplateCategoryKey: 2,
  categoryKey: 10,
  categoryName: 'Groceries',
  categoryOwnerAppuserKey: 7,
  categorySystem: false,
  currencyCode: 'EUR',
  month: 11,
  parentCategoryKey: 9,
  parentCategoryName: 'Food',
  parentCategoryOwnerAppuserKey: 7,
  parentCategorySystem: false,
  period: { end: new Date('2026-12-01T00:00:00Z'), start: new Date('2026-11-01T00:00:00Z') },
  year: 2026,
  ...overrides,
});

const baselineMonth = (month: number, transactions: CategorizedTransaction[]): SpendingBaselineMonth => ({
  month,
  transactions,
  year: 2026,
});

function spendingInput(overrides: Partial<SpendingVsNormalInput> = {}): SpendingVsNormalInput {
  return {
    baselineComplete: true,
    baselineMonths: [
      baselineMonth(8, [transaction({ amount: new Big(100), transactionDate: new Date('2026-08-05T12:00:00Z') })]),
      baselineMonth(9, [transaction({ amount: new Big(100), transactionDate: new Date('2026-09-05T12:00:00Z') })]),
      baselineMonth(10, [transaction({ amount: new Big(100), transactionDate: new Date('2026-10-05T12:00:00Z') })]),
    ],
    currency: 'EUR',
    currentTransactions: [transaction({ amount: new Big(150) })],
    daysElapsed: 10,
    fromDate: '2026-11-01T00:00:00.000Z',
    month: 11,
    toDate: '2026-11-10T12:00:00.000Z',
    year: 2026,
    ...overrides,
  };
}

describe('spendingVsNormalInsights', () => {
  it('does not fire at the start of the month', () => {
    expect(spendingVsNormalInsights(spendingInput({ daysElapsed: 1 }))).toEqual([]);
  });

  it('fires from day 7, not before', () => {
    expect(spendingVsNormalInsights(spendingInput({ daysElapsed: 6 }))).toEqual([]);
    expect(spendingVsNormalInsights(spendingInput({ daysElapsed: 7 }))).toHaveLength(1);
  });

  it('compares the whole month at month end', () => {
    const insights = spendingVsNormalInsights(spendingInput({ daysElapsed: 30 }));
    expect(insights).toHaveLength(1);
    expect(insights[0]?.facts).toMatchObject({ baselineAmount: '100', currentAmount: '150' });
  });

  it('fires at the 25% deviation boundary and not below it', () => {
    const atBoundary = spendingVsNormalInsights(spendingInput({ currentTransactions: [transaction({ amount: new Big(125) })] }));
    expect(atBoundary).toHaveLength(1);
    expect(atBoundary[0]?.facts).toMatchObject({ baselineAmount: '100', currentAmount: '125', deviationPercent: '25.00', direction: 'above' });

    const below = spendingVsNormalInsights(spendingInput({ currentTransactions: [transaction({ amount: new Big(124) })] }));
    expect(below).toEqual([]);
  });

  it('nets refunds against the category and floors a net refund at zero', () => {
    const netted = spendingVsNormalInsights(
      spendingInput({
        baselineMonths: [
          baselineMonth(8, [transaction({ amount: new Big(40) })]),
          baselineMonth(9, [transaction({ amount: new Big(40) })]),
          baselineMonth(10, [transaction({ amount: new Big(40) })]),
        ],
        currentTransactions: [
          transaction({ amount: new Big(100), transactionKey: 1 }),
          transaction({ amount: new Big(-40), transactionKey: 2 }),
        ],
      }),
    );
    expect(netted).toHaveLength(1);
    expect(netted[0]?.facts).toMatchObject({ baselineAmount: '40', currentAmount: '60', deviationPercent: '50.00' });

    const refundOnly = spendingVsNormalInsights(
      spendingInput({
        currentTransactions: [transaction({ amount: new Big(-40), transactionKey: 2 })],
      }),
    );
    expect(refundOnly).toEqual([]);
  });

  it('sums amounts already converted to the base currency', () => {
    const insights = spendingVsNormalInsights(
      spendingInput({
        currentTransactions: [
          transaction({ accountKey: 3, amount: new Big(60), transactionKey: 1 }),
          transaction({ accountKey: 4, amount: new Big(90), transactionKey: 2 }),
        ],
      }),
    );
    expect(insights[0]?.facts).toMatchObject({ currency: 'EUR', currentAmount: '150' });
  });

  it('does not fire without a complete three-month baseline', () => {
    expect(spendingVsNormalInsights(spendingInput({ baselineComplete: false }))).toEqual([]);
    expect(spendingVsNormalInsights(spendingInput({ baselineMonths: [baselineMonth(10, [transaction()])] }))).toEqual([]);
  });

  it('does not fire when the baseline is not material', () => {
    const insights = spendingVsNormalInsights(
      spendingInput({
        baselineMonths: [
          baselineMonth(8, [transaction({ amount: new Big(10) })]),
          baselineMonth(9, [transaction({ amount: new Big(10) })]),
          baselineMonth(10, [transaction({ amount: new Big(10) })]),
        ],
        currentTransactions: [transaction({ amount: new Big(30) })],
      }),
    );
    expect(insights).toEqual([]);
  });

  it('caps the list at three, ranked by absolute deviation', () => {
    const categories = [10, 20, 30, 40].map((categoryKey) => ({
      baseline: transaction({ amount: new Big(100), categoryKey, parentCategoryKey: categoryKey + 100 }),
      current: transaction({ amount: new Big(100 + categoryKey), categoryKey, parentCategoryKey: categoryKey + 100 }),
    }));
    const insights = spendingVsNormalInsights(
      spendingInput({
        baselineMonths: categories.map((category, index) =>
          baselineMonth(8 + index, [category.baseline]),
        ),
        currentTransactions: categories.map((category) => category.current),
      }),
    );
    expect(insights).toHaveLength(3);
    expect(insights.map((insight) => insight.facts.categoryKey)).toEqual([140, 130, 120]);
  });

  it('returns a stable id for the same type, subject and period', () => {
    const first = spendingVsNormalInsights(spendingInput());
    const second = spendingVsNormalInsights(spendingInput());
    expect(first[0]?.id).toBe(second[0]?.id);
    expect(first[0]?.id).toBe(insightId('spending_vs_normal', 'category:9', '2026-11'));

    const nextMonth = spendingVsNormalInsights(spendingInput({ month: 12 }));
    expect(nextMonth[0]?.id).not.toBe(first[0]?.id);
  });

  it('carries the leaf categories and the link range in its facts', () => {
    const insights = spendingVsNormalInsights(
      spendingInput({
        currentTransactions: [
          transaction({ amount: new Big(100), categoryKey: 10, transactionKey: 1 }),
          transaction({ amount: new Big(50), categoryKey: 11, categoryName: 'Restaurants', transactionKey: 2 }),
        ],
      }),
    );
    expect(insights[0]?.facts).toMatchObject({
      categoryKeys: [10, 11],
      fromDate: '2026-11-01T00:00:00.000Z',
      toDate: '2026-11-10T12:00:00.000Z',
    });
  });
});

describe('budgetPaceInsights', () => {
  const input = (overrides: Partial<Parameters<typeof budgetPaceInsights>[0]> = {}) => ({
    allocations: [allocation()],
    currentTransactions: [transaction({ amount: new Big(100) })],
    daysElapsed: 10,
    daysInMonth: 30,
    month: 11,
    year: 2026,
    ...overrides,
  });

  it('projects a hand-computed month-end spend and reports the overrun', () => {
    const insights = budgetPaceInsights(input());
    expect(insights).toHaveLength(1);
    expect(insights[0]).toMatchObject({
      facts: {
        amountBudgeted: '250',
        amountSpent: '100',
        daysElapsed: 10,
        daysInMonth: 30,
        elapsedPercent: '33.33',
        overBy: '50',
        projectedAmount: '300',
      },
      severity: 'warning',
      type: 'budget_pace',
    });
  });

  it('does not fire when the projection stays under the allocation', () => {
    expect(budgetPaceInsights(input({ allocations: [allocation({ amountBudgeted: '400' })] }))).toEqual([]);
  });

  it('does not fire before day 7', () => {
    expect(budgetPaceInsights(input({ daysElapsed: 6 }))).toEqual([]);
  });

  it('is critical once the allocation is already spent', () => {
    const insights = budgetPaceInsights(input({ allocations: [allocation({ amountBudgeted: '50' })] }));
    expect(insights[0]).toMatchObject({ severity: 'critical' });
  });

  it('uses the available amount when rollover is on', () => {
    const insights = budgetPaceInsights(input({ allocations: [allocation({ amountAvailable: '400', amountBudgeted: '250' })] }));
    expect(insights).toEqual([]);
  });

  it('returns a stable id for the same allocation and period', () => {
    const first = budgetPaceInsights(input());
    const second = budgetPaceInsights(input());
    expect(first[0]?.id).toBe(second[0]?.id);
    expect(first[0]?.id).toBe(insightId('budget_pace', 'budget:2', '2026-11'));
  });
});

describe('generateInsights', () => {
  it('orders critical, then warning, then info', () => {
    const insights = generateInsights({
      budgets: [{
        allocations: [allocation({ amountBudgeted: '50' })],
        currentTransactions: [transaction({ amount: new Big(100) })],
        daysElapsed: 10,
        daysInMonth: 30,
        month: 11,
        year: 2026,
      }],
      spending: spendingInput({ currentTransactions: [transaction({ amount: new Big(50) })] }),
    });
    expect(insights.map((insight) => insight.severity)).toEqual(['critical', 'info']);
  });

  it('formats the period as YYYY-MM', () => {
    expect(periodKey(3, 2026)).toBe('2026-03');
  });
});
