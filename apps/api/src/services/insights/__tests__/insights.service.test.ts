import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BudgetAllocationRow, TransactionAggregationRow } from '@service/budget/aggregation-types';

import { InsightsService, resolveInsightsPeriod } from '../insights.service';

const transaction = (overrides: Partial<TransactionAggregationRow> = {}): TransactionAggregationRow => ({
  accountClosed: false,
  accountDeleted: false,
  accountKey: 3,
  accountOwnerAppuserKey: 7,
  accountTenantKey: 11,
  appuserKey: 7,
  assignmentAppuserKey: 7,
  assignmentDeleted: false,
  assignmentKey: 100,
  categoryDeleted: false,
  categoryHasActiveChildren: false,
  categoryKey: 10,
  categoryName: 'Groceries',
  categoryOwnerAppuserKey: 7,
  categorySystem: false,
  effectiveAmount: '-100',
  loanFeeAmount: null,
  loanInterestAmount: null,
  loanLinkDeleted: null,
  loanLinkedByAppuserKey: null,
  loanLinkKey: null,
  loanLinkTenantKey: null,
  parentCategoryDeleted: false,
  parentCategoryKey: 9,
  parentCategoryName: 'Food',
  parentCategoryOwnerAppuserKey: 7,
  parentCategorySystem: false,
  tenantKey: 11,
  transactionDate: new Date('2026-11-10T12:00:00Z'),
  transactionKey: 1,
  transactionType: 'CARD_PAYMENT',
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

const baselineRows = (amount = '-100') => [
  transaction({ effectiveAmount: amount, transactionDate: new Date('2026-08-10T12:00:00Z'), transactionKey: 1 }),
  transaction({ effectiveAmount: amount, transactionDate: new Date('2026-09-10T12:00:00Z'), transactionKey: 2 }),
  transaction({ effectiveAmount: amount, transactionDate: new Date('2026-10-10T12:00:00Z'), transactionKey: 3 }),
];

describe('InsightsService', () => {
  const hasActiveMembership = vi.fn();
  const loadBudgetAllocations = vi.fn();
  const loadTransactions = vi.fn();
  const repository = { hasActiveMembership, loadBudgetAllocations, loadTransactions };
  const service = new InsightsService(repository);

  beforeEach(() => {
    vi.clearAllMocks();
    hasActiveMembership.mockResolvedValue(true);
    loadBudgetAllocations.mockResolvedValue([]);
    loadTransactions.mockResolvedValue([]);
  });

  it('returns nothing before day 7', async () => {
    await expect(
      service.getInsights({ appuserKey: 7, currency: 'EUR', now: new Date('2026-11-05T12:00:00Z'), tenantKey: 11 }),
    ).resolves.toEqual({ insights: [] });
    expect(loadTransactions).not.toHaveBeenCalled();
  });

  it('returns nothing without a three-month baseline', async () => {
    loadTransactions.mockResolvedValue([transaction({ effectiveAmount: '-150' })]);
    await expect(
      service.getInsights({ appuserKey: 7, currency: 'EUR', now: new Date('2026-11-10T18:00:00Z'), tenantKey: 11 }),
    ).resolves.toEqual({ insights: [] });
  });

  it('fires a spending insight once three baseline months exist', async () => {
    loadTransactions.mockResolvedValue([...baselineRows(), transaction({ effectiveAmount: '-150', transactionKey: 4 })]);
    const result = await service.getInsights({ appuserKey: 7, currency: 'EUR', now: new Date('2026-11-10T18:00:00Z'), tenantKey: 11 });

    expect(result.insights).toHaveLength(1);
    expect(result.insights[0]).toMatchObject({
      facts: { baselineAmount: '100', currency: 'EUR', currentAmount: '150', deviationPercent: '50.00' },
      period: '2026-11',
      type: 'spending_vs_normal',
    });
  });

  it('fires a budget-pace insight from the allocations and current-month spend', async () => {
    loadBudgetAllocations.mockResolvedValue([allocation()]);
    loadTransactions.mockResolvedValue([...baselineRows(), transaction({ effectiveAmount: '-100', transactionKey: 4 })]);
    const result = await service.getInsights({ appuserKey: 7, currency: 'EUR', now: new Date('2026-11-10T18:00:00Z'), tenantKey: 11 });

    expect(result.insights).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ facts: expect.objectContaining({ projectedAmount: '300' }), type: 'budget_pace' }),
      ]),
    );
  });

  it('paces a budget over its own budget month, which its start day decides', async () => {
    // November of a budget that starts on the 25th: 25 October to 24 November, 31 days.
    const november = { end: new Date('2026-11-25T00:00:00Z'), start: new Date('2026-10-25T00:00:00Z') };
    loadBudgetAllocations.mockResolvedValue([allocation({ period: november })]);
    loadTransactions.mockResolvedValue([
      ...baselineRows(),
      // Before the budget month: not part of its pace.
      transaction({ effectiveAmount: '-500', transactionDate: new Date('2026-10-24T12:00:00Z'), transactionKey: 4 }),
      transaction({ effectiveAmount: '-170', transactionDate: new Date('2026-11-01T12:00:00Z'), transactionKey: 5 }),
    ]);
    const result = await service.getInsights({ appuserKey: 7, currency: 'EUR', now: new Date('2026-11-10T18:00:00Z'), tenantKey: 11 });

    expect(loadBudgetAllocations).toHaveBeenCalledWith(7, { day: new Date('2026-11-10T00:00:00Z') });
    const pace = result.insights.find((insight) => insight.type === 'budget_pace');
    // 17 of 31 days passed (25 October to 10 November) with 170 spent: 310 projected.
    expect(pace).toMatchObject({ facts: { amountSpent: '170', daysElapsed: 17, daysInMonth: 31, projectedAmount: '310' } });
  });

  it('reads a requested past month as a complete month', async () => {
    loadTransactions.mockResolvedValue([
      transaction({ effectiveAmount: '-100', transactionDate: new Date('2026-05-10T12:00:00Z'), transactionKey: 1 }),
      transaction({ effectiveAmount: '-100', transactionDate: new Date('2026-06-10T12:00:00Z'), transactionKey: 2 }),
      transaction({ effectiveAmount: '-100', transactionDate: new Date('2026-07-10T12:00:00Z'), transactionKey: 3 }),
      transaction({ effectiveAmount: '-150', transactionDate: new Date('2026-08-15T12:00:00Z'), transactionKey: 4 }),
    ]);
    const result = await service.getInsights({ appuserKey: 7, currency: 'EUR', month: '2026-08', now: new Date('2026-11-10T18:00:00Z'), tenantKey: 11 });

    expect(result.insights[0]).toMatchObject({ period: '2026-08', type: 'spending_vs_normal' });
  });

  it('returns nothing for an inactive membership', async () => {
    hasActiveMembership.mockResolvedValue(false);
    await expect(
      service.getInsights({ appuserKey: 7, currency: 'EUR', now: new Date('2026-11-10T18:00:00Z'), tenantKey: 11 }),
    ).resolves.toEqual({ insights: [] });
  });
});

describe('resolveInsightsPeriod', () => {
  it('reads the current month up to today', () => {
    expect(resolveInsightsPeriod(undefined, new Date('2026-11-10T12:00:00Z'))).toMatchObject({
      daysElapsed: 10,
      daysInMonth: 30,
      month: 11,
      year: 2026,
    });
  });

  it('treats a past month as complete', () => {
    expect(resolveInsightsPeriod('2026-02', new Date('2026-11-10T12:00:00Z'))).toMatchObject({
      daysElapsed: 28,
      daysInMonth: 28,
      month: 2,
      year: 2026,
    });
  });

  it('has nothing elapsed for a future month', () => {
    expect(resolveInsightsPeriod('2026-12', new Date('2026-11-10T12:00:00Z')).daysElapsed).toBe(1);
  });
});
