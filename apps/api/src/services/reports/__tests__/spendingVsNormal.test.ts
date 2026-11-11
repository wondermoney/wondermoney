import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BudgetAllocationRow, TransactionAggregationRow } from '@service/budget/aggregation-types';
import type { ReportFilters } from '@validators/reports';

import type { ReportServiceInput } from '../report-filters';
import { resolveSpendingVsNormalPeriod, shiftMonthKey, SpendingVsNormalReportService } from '../spendingVsNormal.service';

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
  transactionDate: new Date('2026-11-05T12:00:00Z'),
  transactionKey: 1,
  transactionType: 'CARD_PAYMENT',
  ...overrides,
});

const makeInput = (overrides: Partial<ReportFilters> = {}): ReportServiceInput =>
  ({
    filters: { includePending: false, includeTransfers: false, timezone: 'Europe/Lisbon', ...overrides },
    tenant: { tenantKey: 11 },
    user: { appuserKey: 7, currencyKey: { code: 'EUR' } },
  }) as unknown as ReportServiceInput;

const NOW = new Date('2026-11-10T18:00:00Z');

let nextTransactionKey = 1;
const nextKey = () => nextTransactionKey++;

/** Three full baseline months, each with the same spend on day 5. */
function baselineRows(amount = '-100', categoryKey = 10, categoryName = 'Groceries', parentCategoryKey = 9, parentCategoryName = 'Food'): TransactionAggregationRow[] {
  return [
    transaction({ categoryKey, categoryName, effectiveAmount: amount, parentCategoryKey, parentCategoryName, transactionDate: new Date('2026-08-05T12:00:00Z'), transactionKey: nextKey() }),
    transaction({ categoryKey, categoryName, effectiveAmount: amount, parentCategoryKey, parentCategoryName, transactionDate: new Date('2026-09-05T12:00:00Z'), transactionKey: nextKey() }),
    transaction({ categoryKey, categoryName, effectiveAmount: amount, parentCategoryKey, parentCategoryName, transactionDate: new Date('2026-10-05T12:00:00Z'), transactionKey: nextKey() }),
  ];
}

function currentRows(): TransactionAggregationRow[] {
  return [
    ...baselineRows(),
    ...baselineRows('-300', 20, 'Rent', 19, 'Home'),
    ...baselineRows('-10', 30, 'Coffee', 29, 'Treats'),
    transaction({ categoryKey: 10, effectiveAmount: '-150', transactionDate: new Date('2026-11-05T12:00:00Z'), transactionKey: nextKey() }),
    transaction({ categoryKey: 11, categoryName: 'Restaurants', effectiveAmount: '-50', transactionDate: new Date('2026-11-06T12:00:00Z'), transactionKey: nextKey() }),
    transaction({ categoryKey: 20, categoryName: 'Rent', effectiveAmount: '-300', parentCategoryKey: 19, parentCategoryName: 'Home', transactionDate: new Date('2026-11-02T12:00:00Z'), transactionKey: nextKey() }),
    transaction({ categoryKey: 30, categoryName: 'Coffee', effectiveAmount: '-30', parentCategoryKey: 29, parentCategoryName: 'Treats', transactionDate: new Date('2026-11-03T12:00:00Z'), transactionKey: nextKey() }),
  ];
}

describe('resolveSpendingVsNormalPeriod', () => {
  it('reads the current month up to now, with the three prior months as the baseline', () => {
    const period = resolveSpendingVsNormalPeriod('2026-11', NOW, 'Europe/Lisbon');

    expect(period).toMatchObject({ daysElapsed: 10, month: 11, monthKey: '2026-11', year: 2026 });
    expect(period.range).toEqual({ fromDate: '2026-11-01T00:00:00.000Z', toDate: '2026-11-30T23:59:59.999Z' });
    expect(period.asOf).toEqual(NOW);
    expect(period.baselineMonths.map((baseline) => baseline.key)).toEqual(['2026-10', '2026-09', '2026-08']);
  });

  it('treats a past month as complete', () => {
    const period = resolveSpendingVsNormalPeriod('2026-08', NOW, 'Europe/Lisbon');

    expect(period.daysElapsed).toBe(31);
    expect(period.asOf).toEqual(new Date('2026-08-31T23:00:00.000Z'));
  });

  it('has nothing elapsed for a future month', () => {
    expect(resolveSpendingVsNormalPeriod('2026-12', NOW, 'Europe/Lisbon').daysElapsed).toBe(1);
  });

  it('reads the month and the day of the cutoff in the caller calendar', () => {
    // 02:00Z on the 10th is still the 9th in New York, and the month starts four hours later.
    const period = resolveSpendingVsNormalPeriod('2026-11', new Date('2026-11-10T02:00:00Z'), 'America/New_York');

    expect(period.daysElapsed).toBe(9);
    expect(period.range.fromDate).toBe('2026-11-01T04:00:00.000Z');
  });

  it('moves a month key across a year boundary', () => {
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
  });
});

describe('SpendingVsNormalReportService', () => {
  const hasActiveMembership = vi.fn();
  const loadBudgetAllocations = vi.fn();
  const loadTransactions = vi.fn();
  const repository = { hasActiveMembership, loadBudgetAllocations, loadTransactions };
  const service = new SpendingVsNormalReportService(repository, () => NOW);

  beforeEach(() => {
    vi.clearAllMocks();
    hasActiveMembership.mockResolvedValue(true);
    loadBudgetAllocations.mockResolvedValue([] as BudgetAllocationRow[]);
    loadTransactions.mockResolvedValue([]);
  });

  it('returns a top-level row per category and its subcategory rows', async () => {
    loadTransactions.mockResolvedValue(currentRows());

    const { data } = await service.getReport(makeInput(), '2026-11');

    expect(data.month).toBe('2026-11');
    expect(data.rows).toEqual([
      { categoryKey: '19', name: 'Home', normal: 300, parentKey: null, ratio: 1, total: 300 },
      { categoryKey: '20', name: 'Rent', normal: 300, parentKey: '19', ratio: 1, total: 300 },
      { categoryKey: '9', name: 'Food', normal: 100, parentKey: null, ratio: 2, total: 200 },
      { categoryKey: '10', name: 'Groceries', normal: 100, parentKey: '9', ratio: 1.5, total: 150 },
      { categoryKey: '11', name: 'Restaurants', normal: null, parentKey: '9', ratio: null, total: 50 },
      { categoryKey: '29', name: 'Treats', normal: 10, parentKey: null, ratio: null, total: 30 },
      { categoryKey: '30', name: 'Coffee', normal: 10, parentKey: '29', ratio: null, total: 30 },
    ]);
  });

  it('shows a category with no baseline neutral, not as above normal', async () => {
    loadTransactions.mockResolvedValue(currentRows());

    const { data } = await service.getReport(makeInput(), '2026-11');
    const restaurants = data.rows.find((row) => row.categoryKey === '11');

    expect(restaurants).toMatchObject({ normal: null, ratio: null, total: 50 });
  });

  it('shows every row neutral without a complete three-month baseline', async () => {
    // September has no rows at all, so the household has no trustworthy normal.
    loadTransactions.mockResolvedValue(currentRows().filter((row) => row.transactionDate?.getUTCMonth() !== 8));

    const { data } = await service.getReport(makeInput(), '2026-11');

    expect(data.rows.length).toBeGreaterThan(0);
    expect(data.rows.every((row) => row.normal === null && row.ratio === null)).toBe(true);
  });

  it('shows every row neutral before the month is a week old', async () => {
    loadTransactions.mockResolvedValue(currentRows());
    const early = new SpendingVsNormalReportService(repository, () => new Date('2026-11-03T18:00:00Z'));

    const { data } = await early.getReport(makeInput(), '2026-11');

    expect(data.rows.every((row) => row.normal === null && row.ratio === null)).toBe(true);
  });

  it('applies the account filter to the rows it counts', async () => {
    loadTransactions.mockResolvedValue([
      ...currentRows(),
      transaction({ accountKey: 4, categoryKey: 20, categoryName: 'Rent', effectiveAmount: '-300', parentCategoryKey: 19, parentCategoryName: 'Home', transactionDate: new Date('2026-11-02T12:00:00Z'), transactionKey: nextKey() }),
    ]);

    const { data } = await service.getReport(makeInput({ accountKeys: ['3'] }), '2026-11');

    expect(data.rows.find((row) => row.categoryKey === '19')?.total).toBe(300);
  });

  it('applies the category filter to the rows it counts', async () => {
    loadTransactions.mockResolvedValue(currentRows());

    const { data } = await service.getReport(makeInput({ categoryKeys: ['10'] }), '2026-11');

    expect(data.rows.map((row) => [row.categoryKey, row.total])).toEqual([
      ['9', 150],
      ['10', 150],
    ]);
  });

  it('returns no rows for a month that has not started', async () => {
    loadTransactions.mockResolvedValue(currentRows());

    const { data } = await service.getReport(makeInput(), '2026-12');

    expect(data.rows).toEqual([]);
  });

  it('returns no rows for an inactive membership', async () => {
    hasActiveMembership.mockResolvedValue(false);

    const { data } = await service.getReport(makeInput(), '2026-11');

    expect(data.rows).toEqual([]);
    expect(loadTransactions).not.toHaveBeenCalled();
  });

  it('asks the repository for the viewer and the household, over the baseline window', async () => {
    loadTransactions.mockResolvedValue([]);

    await service.getReport(makeInput(), '2026-11');

    expect(loadTransactions).toHaveBeenCalledWith(7, 11, {
      end: NOW,
      start: new Date('2026-07-31T23:00:00.000Z'),
    });
  });

  it('counts the rows it could not value in the viewer currency', async () => {
    loadTransactions.mockResolvedValue([
      ...currentRows(),
      transaction({ categoryKey: 10, effectiveAmount: null, transactionDate: new Date('2026-11-07T12:00:00Z'), transactionKey: nextKey() }),
    ]);

    const { completeness } = await service.getReport(makeInput(), '2026-11');

    expect(completeness).toMatchObject({ currencyCode: 'EUR', isComplete: false, unconvertedTransactions: 1 });
  });
});
