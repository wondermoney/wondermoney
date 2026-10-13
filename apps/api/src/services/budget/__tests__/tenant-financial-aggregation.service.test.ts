import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getLisbonBudgetPeriod } from '../aggregation-periods';
import type { BudgetAllocationRow, TransactionAggregationRow } from '../aggregation-types';
import { TenantFinancialAggregationService } from '../tenant-financial-aggregation.service';

const input = { appuserKey: 7, scheduledFor: '2026-07-13T08:00:00Z', tenantKey: 11 };

const allocation = (overrides: Partial<BudgetAllocationRow> = {}): BudgetAllocationRow => ({
  accountClosed: false,
  accountDeleted: false,
  accountKey: 3,
  accountOwnerAppuserKey: 7,
  accountTenantKey: 11,
  amountBudgeted: '100',
  budgetKey: 1,
  budgetName: 'July plan',
  budgetTemplateCategoryKey: 2,
  categoryKey: 10,
  categoryName: 'Groceries',
  categoryOwnerAppuserKey: 7,
  categorySystem: false,
  currencyCode: 'EUR',
  parentCategoryKey: 9,
  parentCategoryName: 'Food',
  parentCategoryOwnerAppuserKey: 7,
  parentCategorySystem: false,
  ...overrides,
});

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
  effectiveAmount: '-80',
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
  transactionDate: new Date('2026-07-07T12:00:00Z'),
  transactionKey: 50,
  transactionType: 'CARD_PAYMENT',
  ...overrides,
});

describe('TenantFinancialAggregationService', () => {
  const hasActiveMembership = vi.fn();
  const loadBudgetAllocations = vi.fn();
  const loadTransactions = vi.fn();
  const service = new TenantFinancialAggregationService({ hasActiveMembership, loadBudgetAllocations, loadTransactions });

  beforeEach(() => {
    vi.clearAllMocks();
    hasActiveMembership.mockResolvedValue(true);
    loadBudgetAllocations.mockResolvedValue([allocation()]);
    loadTransactions.mockResolvedValue([transaction()]);
  });

  it('requires an active undeleted membership before loading tenant facts', async () => {
    hasActiveMembership.mockResolvedValue(false);
    await expect(service.aggregateBudgetThresholds(input)).resolves.toMatchObject({ reason: 'inactive_membership', status: 'suppressed' });
    expect(loadBudgetAllocations).not.toHaveBeenCalled();
  });

  it.each([
    [{ accountTenantKey: 99 }, 'budget_account_tenant_mismatch'],
    [{ accountOwnerAppuserKey: 99 }, 'budget_account_owner_mismatch'],
    [{ accountClosed: true }, 'budget_account_unavailable'],
    [{ accountDeleted: true }, 'budget_account_unavailable'],
    [{ accountKey: null }, 'budget_no_accounts'],
  ])('suppresses the entire budget for an invalid linked account', async (changes, reason) => {
    loadBudgetAllocations.mockResolvedValue([allocation(changes)]);
    const result = await service.aggregateBudgetThresholds(input);
    expect(result).toMatchObject({ facts: [], suppressedBudgets: [{ budgetKey: 1, reason }] });
  });

  it('considers only positive child-category allocations', async () => {
    loadBudgetAllocations.mockResolvedValue([
      allocation({ budgetTemplateCategoryKey: 1, parentCategoryKey: null }),
      allocation({ amountBudgeted: '0', budgetTemplateCategoryKey: 2 }),
    ]);
    await expect(service.aggregateBudgetThresholds(input)).resolves.toMatchObject({ facts: [], suppressedBudgets: [] });
  });

  it('uses distinct transactions, excludes transfers/missing amounts/ambiguous assignments, and preserves diagnostics', async () => {
    loadTransactions.mockResolvedValue([
      transaction({ transactionKey: 1, transactionType: 'TRANSFER_OUT' }),
      transaction({ effectiveAmount: null, transactionKey: 2 }),
      transaction({ assignmentKey: 301, categoryKey: 10, transactionKey: 3 }),
      transaction({ assignmentKey: 302, categoryKey: 20, transactionKey: 3 }),
      transaction({ assignmentKey: 401, effectiveAmount: '-80', transactionKey: 4 }),
      transaction({ assignmentKey: 401, effectiveAmount: '-80', transactionKey: 4 }),
    ]);
    const result = await service.aggregateBudgetThresholds(input);
    expect(result).toMatchObject({
      diagnostics: {
        ambiguousCategoryAssignments: 1,
        duplicateTransactionRows: 2,
        excludedTransfers: 1,
        missingConvertedAmounts: 1,
      },
      facts: [{ amountSpent: '80', state: 'near' }],
    });
  });

  it('applies signed refunds and floors a refund greater than expense at zero', async () => {
    loadTransactions.mockResolvedValue([
      transaction({ effectiveAmount: '-50', transactionKey: 1 }),
      transaction({ effectiveAmount: '60', transactionKey: 2 }),
    ]);
    await expect(service.aggregateBudgetThresholds(input)).resolves.toMatchObject({ facts: [] });

    loadTransactions.mockResolvedValue([
      transaction({ effectiveAmount: '-100', transactionKey: 1 }),
      transaction({ effectiveAmount: '20', transactionKey: 2 }),
    ]);
    await expect(service.aggregateBudgetThresholds(input)).resolves.toMatchObject({ facts: [{ amountSpent: '80' }] });
  });

  it('does not count soft-deleted category assignments', async () => {
    loadTransactions.mockResolvedValue([transaction({ assignmentDeleted: true })]);
    await expect(service.aggregateBudgetThresholds(input)).resolves.toMatchObject({
      diagnostics: { uncategorizedTransactions: 1 },
      facts: [],
    });
  });

  it('fails closed and diagnoses an invalid transaction timestamp', async () => {
    loadTransactions.mockResolvedValue([transaction({ transactionDate: null })]);
    await expect(service.aggregateBudgetThresholds(input)).resolves.toMatchObject({
      diagnostics: { invalidTransactionDates: 1 },
      facts: [],
    });
  });

  it('excludes loan principal and includes only interest plus fee', async () => {
    loadBudgetAllocations.mockResolvedValue([allocation({ amountBudgeted: '12' })]);
    loadTransactions.mockResolvedValue([
      transaction({
        effectiveAmount: '-1000',
        loanFeeAmount: '2',
        loanInterestAmount: '10',
        loanLinkDeleted: false,
        loanLinkedByAppuserKey: 7,
        loanLinkKey: 70,
        loanLinkTenantKey: 11,
      }),
    ]);
    await expect(service.aggregateBudgetThresholds(input)).resolves.toMatchObject({
      facts: [{ amountSpent: '12', claimThresholds: [80, 100], state: 'at_limit' }],
    });
  });

  it('returns a positive overage amount', async () => {
    loadTransactions.mockResolvedValue([transaction({ effectiveAmount: '-125' })]);
    await expect(service.aggregateBudgetThresholds(input)).resolves.toMatchObject({
      facts: [{ remainingOrOverAmount: '25', state: 'over' }],
    });
  });

  it('sums distinct valid loan links despite assignment Cartesian rows and rejects any invalid active link', async () => {
    loadBudgetAllocations.mockResolvedValue([allocation({ amountBudgeted: '10' })]);
    const first = transaction({ loanFeeAmount: '1', loanInterestAmount: '4', loanLinkDeleted: false, loanLinkedByAppuserKey: 7, loanLinkKey: 1, loanLinkTenantKey: 11 });
    const second = transaction({ loanFeeAmount: '2', loanInterestAmount: '3', loanLinkDeleted: false, loanLinkedByAppuserKey: 7, loanLinkKey: 2, loanLinkTenantKey: 11 });
    loadTransactions.mockResolvedValue([first, first, second, second]);
    await expect(service.aggregateBudgetThresholds(input)).resolves.toMatchObject({ facts: [{ amountSpent: '10' }] });
    loadTransactions.mockResolvedValue([first, transaction({ ...second, loanLinkTenantKey: 99 })]);
    await expect(service.aggregateBudgetThresholds(input)).resolves.toMatchObject({ diagnostics: { invalidLoanLinks: 1 }, facts: [] });
  });

  it('returns weekly deterministic facts, tie-breaks top category, omits zero comparison, and reports budget status', async () => {
    loadBudgetAllocations.mockResolvedValue([allocation({ amountBudgeted: '10' })]);
    loadTransactions.mockResolvedValue([
      transaction({ categoryKey: 20, categoryName: 'Transport', effectiveAmount: '-12', transactionKey: 1 }),
      transaction({ categoryKey: 10, effectiveAmount: '-12', transactionKey: 2 }),
      transaction({ categoryKey: 20, categoryName: 'Transport', effectiveAmount: '0', transactionDate: new Date('2026-07-01T12:00:00Z'), transactionKey: 3 }),
    ]);

    await expect(service.aggregateWeeklyInsights(input)).resolves.toMatchObject({
      facts: {
        activeBudgetStatus: 'over',
        comparisonPercentage: null,
        comparisonWeekTotal: null,
        subjectWeekTotal: '24',
        topCategory: { amount: '12', categoryKey: 10, displayName: 'Food / Groceries' },
      },
      status: 'ok',
    });
  });

  it('suppresses weekly output without a uniquely categorized subject transaction', async () => {
    loadTransactions.mockResolvedValue([
      transaction({ assignmentKey: 1, categoryKey: 10 }),
      transaction({ assignmentKey: 2, categoryKey: 20 }),
    ]);
    await expect(service.aggregateWeeklyInsights(input)).resolves.toMatchObject({
      reason: 'no_uniquely_categorized_transactions',
      status: 'suppressed',
    });
  });

  it('suppresses refund-only weekly output with no useful positive section', async () => {
    loadTransactions.mockResolvedValue([transaction({ effectiveAmount: '50' })]);
    await expect(service.aggregateWeeklyInsights(input)).resolves.toMatchObject({ reason: 'no_useful_sections', status: 'suppressed' });
  });

  describe('aggregateMonthlyInsights', () => {
    it('requires an active membership', async () => {
      hasActiveMembership.mockResolvedValue(false);
      await expect(service.aggregateMonthlyInsights(input)).resolves.toMatchObject({ reason: 'inactive_membership', status: 'suppressed' });
      expect(loadTransactions).not.toHaveBeenCalled();
    });

    it('totals month spend and picks the top category', async () => {
      loadTransactions.mockResolvedValue([
        transaction({ categoryKey: 20, categoryName: 'Transport', effectiveAmount: '-30', transactionKey: 1 }),
        transaction({ effectiveAmount: '-80', transactionKey: 2 }),
      ]);
      await expect(service.aggregateMonthlyInsights(input)).resolves.toMatchObject({
        facts: { monthTotal: '110', topCategory: { amount: '80', categoryKey: 10, displayName: 'Food / Groceries' } },
        status: 'ok',
      });
    });

    it('suppresses with no uniquely categorized transactions', async () => {
      loadTransactions.mockResolvedValue([transaction({ transactionType: 'TRANSFER_OUT' })]);
      await expect(service.aggregateMonthlyInsights(input)).resolves.toMatchObject({
        reason: 'no_uniquely_categorized_transactions',
        status: 'suppressed',
      });
    });
  });

  describe('aggregateBudgetRemaining', () => {
    it('requires an active membership', async () => {
      hasActiveMembership.mockResolvedValue(false);
      await expect(service.aggregateBudgetRemaining(input)).resolves.toMatchObject({ reason: 'inactive_membership', status: 'suppressed' });
      expect(loadBudgetAllocations).not.toHaveBeenCalled();
    });

    it('suppresses when no valid allocations exist', async () => {
      loadBudgetAllocations.mockResolvedValue([]);
      await expect(service.aggregateBudgetRemaining(input)).resolves.toMatchObject({ reason: 'no_useful_sections', status: 'suppressed' });
    });

    it('sums headroom across allocations regardless of threshold', async () => {
      await expect(service.aggregateBudgetRemaining(input)).resolves.toMatchObject({
        facts: { remaining: '20', spent: '80', totalBudgeted: '100' },
        status: 'ok',
      });
    });

    it('floors total remaining at zero when overspent', async () => {
      loadTransactions.mockResolvedValue([transaction({ effectiveAmount: '-150' })]);
      await expect(service.aggregateBudgetRemaining(input)).resolves.toMatchObject({
        facts: { remaining: '0', spent: '150', totalBudgeted: '100' },
        status: 'ok',
      });
    });
  });

  describe('aggregateMonthlyStory', () => {
    // input.scheduledFor is '2026-07-13T08:00:00Z' (the trigger month, July 2026 Lisbon local) ->
    // the subject month is the just-closed month, June 2026. The baseline months are the 3 months
    // before the subject: May, April, March 2026.
    const subjectRange = getLisbonBudgetPeriod('2026-06-15T12:00:00Z').monthRange;
    const aprilRange = getLisbonBudgetPeriod('2026-04-15T12:00:00Z').monthRange;

    it('requires an active membership', async () => {
      hasActiveMembership.mockResolvedValue(false);
      await expect(service.aggregateMonthlyStory(input)).resolves.toMatchObject({
        monthsAvailable: 0,
        monthsNeeded: 3,
        reason: 'insufficient_history',
        status: 'insufficient_data',
      });
      expect(loadTransactions).not.toHaveBeenCalled();
    });

    it('reports insufficient_history when fewer than 3 prior months have any transactions', async () => {
      // all 3 baseline months empty -> monthsAvailable: 0
      loadTransactions.mockImplementation((_appuserKey, _tenantKey, range) =>
        range.start.getTime() === subjectRange.start.getTime() ? [transaction()] : [],
      );
      await expect(service.aggregateMonthlyStory(input)).resolves.toMatchObject({
        monthsAvailable: 0,
        monthsNeeded: 3,
        reason: 'insufficient_history',
        status: 'insufficient_data',
      });

      // May and March have transactions, April doesn't -> only 2 of 3 baseline months qualify
      loadTransactions.mockImplementation((_appuserKey, _tenantKey, range) => {
        if (range.start.getTime() === subjectRange.start.getTime()) return [transaction()];
        if (range.start.getTime() === aprilRange.start.getTime()) return [];
        return [transaction()];
      });
      await expect(service.aggregateMonthlyStory(input)).resolves.toMatchObject({
        monthsAvailable: 2,
        monthsNeeded: 3,
        reason: 'insufficient_history',
        status: 'insufficient_data',
      });
    });

    it('reports zero_activity when the subject month has no classified transactions but baseline months do', async () => {
      loadTransactions.mockImplementation((_appuserKey, _tenantKey, range) =>
        range.start.getTime() === subjectRange.start.getTime() ? [] : [transaction()],
      );
      await expect(service.aggregateMonthlyStory(input)).resolves.toMatchObject({
        monthsAvailable: 3,
        monthsNeeded: 3,
        reason: 'zero_activity',
        status: 'insufficient_data',
      });
    });

    it('computes income/spending vs. the 3-month trailing average, sign-based (positive effectiveAmount = income, negative = spending)', async () => {
      loadTransactions.mockImplementation((_appuserKey, _tenantKey, range) =>
        range.start.getTime() === subjectRange.start.getTime()
          ? [
              transaction({ effectiveAmount: '2000', transactionKey: 1 }), // income
              transaction({ effectiveAmount: '-500', transactionKey: 2 }), // spend
            ]
          : [
              transaction({ effectiveAmount: '1800', transactionKey: 1 }), // income
              transaction({ effectiveAmount: '-400', transactionKey: 2 }), // spend
            ],
      );
      await expect(service.aggregateMonthlyStory(input)).resolves.toMatchObject({
        facts: {
          incomeBaseline: '1800',
          incomeSubject: '2000',
          spendingBaseline: '400',
          spendingSubject: '500',
        },
        status: 'ok',
      });
    });

    it('ranks category deltas by absolute € delta, not percentage', async () => {
      loadTransactions.mockImplementation((_appuserKey, _tenantKey, range) =>
        range.start.getTime() === subjectRange.start.getTime()
          ? [
              transaction({ categoryKey: 10, effectiveAmount: '-550', transactionKey: 1 }), // category A: baseline 500 -> subject 550, delta 50 (10%)
              transaction({ categoryKey: 20, categoryName: 'Transport', effectiveAmount: '-60', transactionKey: 2 }), // category B: baseline 20 -> subject 60, delta 40 (200%)
            ]
          : [
              transaction({ categoryKey: 10, effectiveAmount: '-500', transactionKey: 1 }),
              transaction({ categoryKey: 20, categoryName: 'Transport', effectiveAmount: '-20', transactionKey: 2 }),
            ],
      );
      await expect(service.aggregateMonthlyStory(input)).resolves.toMatchObject({
        facts: {
          // category A (delta 50) ranks above category B (delta 40) despite B's much larger percentage swing
          categoryDeltas: [
            { baselineAmount: '500', categoryKey: 10, subjectAmount: '550' },
            { baselineAmount: '20', categoryKey: 20, subjectAmount: '60' },
          ],
        },
        status: 'ok',
      });
    });

    it('computes savings rate as a percentage-point delta, and omits it when income is zero', async () => {
      loadTransactions.mockImplementation((_appuserKey, _tenantKey, range) =>
        range.start.getTime() === subjectRange.start.getTime()
          ? [transaction({ effectiveAmount: '-300', transactionKey: 1 })] // spend only, zero income
          : [
              transaction({ effectiveAmount: '1000', transactionKey: 1 }),
              transaction({ effectiveAmount: '-400', transactionKey: 2 }),
            ],
      );
      await expect(service.aggregateMonthlyStory(input)).resolves.toMatchObject({
        facts: {
          savingsRateBaseline: '60.00', // (1000 - 400) / 1000 * 100
          savingsRateSubject: null, // income is zero -> savings rate is undefined, not Infinity/NaN
        },
        status: 'ok',
      });
    });

    it('applies floorMoney/money formatting consistent with existing aggregations (no negative totals)', async () => {
      // Refund-only subject month: a positive effectiveAmount is income/refund (never spend), so the
      // spending total has nothing to sum and must format as a clean '0', not '-0' or an empty string.
      loadTransactions.mockImplementation((_appuserKey, _tenantKey, range) =>
        range.start.getTime() === subjectRange.start.getTime()
          ? [transaction({ effectiveAmount: '200', transactionKey: 1 })]
          : [transaction({ effectiveAmount: '-100', transactionKey: 1 })],
      );
      await expect(service.aggregateMonthlyStory(input)).resolves.toMatchObject({
        facts: { spendingSubject: '0' },
        status: 'ok',
      });
    });

    it('computes budgetPressure by reusing loadBudgetAllocations/classifyBudgetThreshold, over taking priority over near', async () => {
      loadBudgetAllocations.mockResolvedValue([
        allocation({ amountBudgeted: '100', categoryKey: 10 }),
        allocation({ amountBudgeted: '50', budgetTemplateCategoryKey: 3, categoryKey: 20, categoryName: 'Transport' }),
      ]);
      loadTransactions.mockImplementation((_appuserKey, _tenantKey, range) =>
        range.start.getTime() === subjectRange.start.getTime()
          ? [
              transaction({ categoryKey: 10, effectiveAmount: '-90', transactionKey: 1 }), // 90/100 = 90% -> near
              transaction({ categoryKey: 20, categoryName: 'Transport', effectiveAmount: '-60', transactionKey: 2 }), // 60/50 = 120% -> over
            ]
          : [transaction({ effectiveAmount: '-30' })],
      );
      await expect(service.aggregateMonthlyStory(input)).resolves.toMatchObject({
        facts: { budgetPressure: 'over' },
        status: 'ok',
      });
    });

    it('returns budgetPressure null when there are no valid budget allocations for the month', async () => {
      loadBudgetAllocations.mockResolvedValue([]);
      await expect(service.aggregateMonthlyStory(input)).resolves.toMatchObject({
        facts: { budgetPressure: null },
        status: 'ok',
      });
    });

    it('narrates the JUST-CLOSED month, not the trigger month, when the cron fires on the 1st', async () => {
      // The production cron ('0 9 1 * *') fires on the 1st at 9am. For a 1st-of-September trigger,
      // the subject month must be August (the month that just closed), not September (the month that
      // just started). Baselines are the 3 months before August: May, June, July.
      const septemberRange = getLisbonBudgetPeriod('2026-09-01T08:00:00Z').monthRange;
      loadTransactions.mockResolvedValue([transaction()]);
      const result = await service.aggregateMonthlyStory({ appuserKey: 7, scheduledFor: '2026-09-01T08:00:00Z', tenantKey: 11 });
      expect(result).toMatchObject({ period: { month: 8, year: 2026 }, status: 'ok' });
      // The subject transaction load must NOT be for September (the trigger month).
      const loadedRangeStarts = loadTransactions.mock.calls.map((call) => (call[2] as { start: Date }).start.getTime());
      expect(loadedRangeStarts).not.toContain(septemberRange.start.getTime());
    });
  });
});
