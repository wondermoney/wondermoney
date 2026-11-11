import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReportFilters } from '@validators/reports';

import type { ReportServiceInput } from '../report-filters';

const mocks = vi.hoisted(() => ({ cashflow: vi.fn(), spending: vi.fn() }));

vi.mock('../cashflow.service', () => ({ getCashflowReport: mocks.cashflow }));
vi.mock('../spendingByCategory.service', () => ({ getSpendingByCategoryReport: mocks.spending }));

import { buildMonthComparisonCsv, getMonthComparisonCsv, getMonthComparisonReport, monthRange } from '../monthComparison.service';

const makeInput = (overrides: Partial<ReportFilters> = {}): ReportServiceInput =>
  ({
    filters: { includePending: false, includeTransfers: false, timezone: 'Europe/Lisbon', ...overrides },
    tenant: { tenantKey: 113 },
    user: { appuserKey: 71, currencyKey: { code: 'EUR' } },
  }) as unknown as ReportServiceInput;

const completeness = { currencyCode: 'EUR', isComplete: true, unconvertedCurrencies: [], unconvertedTransactions: 0 };

const cashflowRow = (month: string, income: number, expenses: number) => ({
  expenses,
  income,
  month: `${month}-01T00:00:00.000Z`,
  net: income - expenses,
  savingsRate: income === 0 ? null : (income - expenses) / income,
});

const spendingRow = (categoryKey: string, name: string, totalAmount: number, color = '#111111') => ({
  categoryKey,
  color,
  name,
  parentKey: null,
  percentOfTotal: 0,
  totalAmount,
  transactionCount: 1,
});

/**
 * The comparison composes the two shipped reports rather than re-deriving money or privacy rules.
 * These tests pin the composition: each month is asked for with its own calendar-month range, and
 * the rows are joined and differenced. The integration test proves the numbers equal the reports.
 */
describe('monthRange', () => {
  it('covers the whole calendar month in the report time zone', () => {
    expect(monthRange('2026-08', 'Europe/Lisbon')).toEqual({
      fromDate: '2026-07-31T23:00:00.000Z',
      toDate: '2026-08-31T22:59:59.999Z',
    });
  });

  it('rolls December into the next year', () => {
    expect(monthRange('2026-12', 'UTC')).toEqual({
      fromDate: '2026-12-01T00:00:00.000Z',
      toDate: '2026-12-31T23:59:59.999Z',
    });
  });
});

describe('getMonthComparisonReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cashflow.mockResolvedValue({ completeness, data: [] });
    mocks.spending.mockResolvedValue({ completeness, data: [] });
  });

  it('asks each report for exactly one month, in the caller calendar', async () => {
    mocks.cashflow.mockResolvedValue({ completeness, data: [cashflowRow('2026-08', 1000, 400)] });

    await getMonthComparisonReport(makeInput({ timezone: 'Europe/Lisbon' }), { base: '2026-08', compare: '2026-07' });

    const ranges = mocks.cashflow.mock.calls.map(([input]) => ({
      fromDate: (input as ReportServiceInput).filters.fromDate,
      toDate: (input as ReportServiceInput).filters.toDate,
    }));
    expect(ranges).toEqual([
      { fromDate: '2026-07-31T23:00:00.000Z', toDate: '2026-08-31T22:59:59.999Z' },
      { fromDate: '2026-06-30T23:00:00.000Z', toDate: '2026-07-31T22:59:59.999Z' },
    ]);
    expect(mocks.spending.mock.calls.map(([input]) => (input as ReportServiceInput).filters.fromDate)).toEqual([
      '2026-07-31T23:00:00.000Z',
      '2026-06-30T23:00:00.000Z',
    ]);
  });

  it('reports both months\' totals, with an absent month measured as zero', async () => {
    mocks.cashflow.mockImplementation(({ filters }: ReportServiceInput) =>
      Promise.resolve({
        completeness,
        data: filters.fromDate === '2026-07-31T23:00:00.000Z'
          ? [cashflowRow('2026-08', 1000, 400)]
          : [],
      }));

    const { data } = await getMonthComparisonReport(makeInput(), { base: '2026-08', compare: '2026-07' });

    expect(data.base).toEqual({ expenses: 400, income: 1000, month: '2026-08', net: 600, savingsRate: 0.6 });
    expect(data.compare).toEqual({ expenses: 0, income: 0, month: '2026-07', net: 0, savingsRate: null });
  });

  it('joins categories present in only one month and differences them', async () => {
    mocks.spending.mockImplementation(({ filters }: ReportServiceInput) =>
      Promise.resolve({
        completeness,
        data: filters.fromDate === '2026-07-31T23:00:00.000Z'
          ? [spendingRow('10', 'Food', 150), spendingRow('11', 'Rent', 900)]
          : [spendingRow('10', 'Food', 100), spendingRow('12', 'Travel', 40)],
      }));

    const { data } = await getMonthComparisonReport(makeInput(), { base: '2026-08', compare: '2026-07' });

    expect(data.categories).toEqual([
      { base: 900, categoryKey: '11', color: '#111111', compare: 0, delta: 900, deltaPct: null, name: 'Rent' },
      { base: 150, categoryKey: '10', color: '#111111', compare: 100, delta: 50, deltaPct: 50, name: 'Food' },
      { base: 0, categoryKey: '12', color: '#111111', compare: 40, delta: -40, deltaPct: -100, name: 'Travel' },
    ]);
  });

  it('sorts by absolute delta, so a large fall leads a small rise', async () => {
    mocks.spending.mockImplementation(({ filters }: ReportServiceInput) =>
      Promise.resolve({
        completeness,
        data: filters.fromDate === '2026-07-31T23:00:00.000Z'
          ? [spendingRow('10', 'Food', 10), spendingRow('11', 'Rent', 100)]
          : [spendingRow('10', 'Food', 20), spendingRow('11', 'Rent', 900)],
      }));

    const { data } = await getMonthComparisonReport(makeInput(), { base: '2026-08', compare: '2026-07' });

    expect(data.categories.map((row) => [row.categoryKey, row.delta])).toEqual([
      ['11', -800],
      ['10', -10],
    ]);
  });

  it('counts the rows each month leaves out of the totals', async () => {
    mocks.cashflow.mockImplementation(({ filters }: ReportServiceInput) =>
      Promise.resolve({
        completeness: {
          currencyCode: 'EUR',
          isComplete: false,
          unconvertedCurrencies: filters.fromDate === '2026-07-31T23:00:00.000Z' ? ['USD'] : ['GBP'],
          unconvertedTransactions: 1,
        },
        data: [],
      }));

    const { completeness: merged } = await getMonthComparisonReport(makeInput(), { base: '2026-08', compare: '2026-07' });

    expect(merged).toEqual({
      currencyCode: 'EUR',
      isComplete: false,
      unconvertedCurrencies: ['GBP', 'USD'],
      unconvertedTransactions: 2,
    });
  });
});

describe('buildMonthComparisonCsv', () => {
  it('emits a totals section then a categories section', () => {
    const csv = buildMonthComparisonCsv({
      base: { expenses: 400, income: 1000, month: '2026-08', net: 600, savingsRate: 0.6 },
      categories: [
        { base: 150, categoryKey: '10', color: '#f3f3f3', compare: 100, delta: 50, deltaPct: 50, name: 'Food' },
        { base: 900, categoryKey: '11', color: '#222222', compare: 0, delta: 900, deltaPct: null, name: 'Rent' },
      ],
      compare: { expenses: 300, income: 900, month: '2026-07', net: 600, savingsRate: 0.6667 },
    });

    expect(csv).toBe(
      '\uFEFF# totals\nmonth,income,expenses,net,savingsRate\n2026-08,1000.00,400.00,600.00,0.60\n2026-07,900.00,300.00,600.00,0.67\n\n# categories\ncategoryKey,name,color,base,compare,delta,deltaPct\n10,Food,#f3f3f3,150.00,100.00,50.00,50.00\n11,Rent,#222222,900.00,0.00,900.00,\n',
    );
  });
});

describe('getMonthComparisonCsv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cashflow.mockResolvedValue({ completeness, data: [] });
    mocks.spending.mockResolvedValue({ completeness, data: [] });
  });

  it('exports exactly the rows the JSON response returns', async () => {
    mocks.cashflow.mockImplementation(({ filters }: ReportServiceInput) =>
      Promise.resolve({
        completeness,
        data: filters.fromDate === '2026-07-31T23:00:00.000Z' ? [cashflowRow('2026-08', 1000, 400)] : [cashflowRow('2026-07', 900, 300)],
      }));
    mocks.spending.mockImplementation(({ filters }: ReportServiceInput) =>
      Promise.resolve({
        completeness,
        data: filters.fromDate === '2026-07-31T23:00:00.000Z' ? [spendingRow('10', 'Food', 150)] : [spendingRow('10', 'Food', 100)],
      }));

    const input = makeInput();
    const months = { base: '2026-08', compare: '2026-07' };
    const { data } = await getMonthComparisonReport(input, months);
    const csv = await getMonthComparisonCsv(input, months);

    expect(csv).toBe(buildMonthComparisonCsv(data));
  });
});
