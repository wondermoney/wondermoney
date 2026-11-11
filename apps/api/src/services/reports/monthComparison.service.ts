import { fromZonedTime } from 'date-fns-tz';

import { type CashflowRow, getCashflowReport } from './cashflow.service';
import { round2, toCsv } from './csv';
import type { ReportCompleteness, ReportResult } from './report-currency';
import type { ReportServiceInput } from './report-filters';
import { resolveReportTimeZone } from './report-months';
import { getSpendingByCategoryReport, type SpendingByCategoryRow } from './spendingByCategory.service';

/**
 * Month-vs-month comparison.
 *
 * The report answers one question — what changed between two months, category by
 * category — by composing the two reports that already own the answer: the totals
 * are the cash-flow report's rows for each month, and the category rows are the
 * spending-by-category report's rows for each month. Nothing about money, currency
 * conversion, refunds, transfers, privacy or "counts as spending" is re-derived
 * here, so a comparison can never disagree with the report it is comparing.
 *
 * Each month is requested with its own calendar-month range in the caller's time
 * zone (`report-months.ts`), the same calendar the cash-flow report buckets in.
 * A month with no matching transaction is a measured zero in the comparison — the
 * two months were asked for explicitly, so "nothing happened" is an answer, unlike
 * the cash-flow series where an absent month means "nothing to say".
 */

export interface MonthComparisonCategoryRow {
  /** Spending in the base month. */
  base: number;
  categoryKey: string;
  color: string;
  /** Spending in the compare month. */
  compare: number;
  /** `base - compare`: positive when the category grew. */
  delta: number;
  /** `delta / compare`, as a percentage; null when the compare month has no spending there. */
  deltaPct: null | number;
  name: string;
}

export interface MonthComparisonData {
  base: MonthComparisonTotals;
  categories: MonthComparisonCategoryRow[];
  compare: MonthComparisonTotals;
}

export interface MonthComparisonMonths {
  /** The month being examined. */
  base: string;
  /** The month it is compared against. */
  compare: string;
}

export interface MonthComparisonTotals {
  expenses: number;
  income: number;
  /** `YYYY-MM`. */
  month: string;
  net: number;
  /** `(income - expenses) / income`; null when the month has no income. */
  savingsRate: null | number;
}

const MONTH_KEY = /^\d{4}-(?:0[1-9]|1[0-2])$/;

/**
 * The instants a `YYYY-MM` month covers in `timeZone`: the first instant of its
 * first day through the last instant of its last day, as the report filters carry
 * them. `fromZonedTime` owns the offset rules, so a DST change inside the month is
 * handled without a fixed-offset approximation.
 */
export function monthRange(monthKey: string, timeZone: string): { fromDate: string; toDate: string } {
  if (!MONTH_KEY.test(monthKey)) throw new RangeError(`Not a YYYY-MM month: ${monthKey}`);
  const [year, month] = monthKey.split('-').map(Number) as [number, number];
  const nextMonth = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  const start = fromZonedTime(`${monthKey}-01T00:00:00`, timeZone);
  const end = new Date(fromZonedTime(`${nextMonth}-01T00:00:00`, timeZone).getTime() - 1);
  return { fromDate: start.toISOString(), toDate: end.toISOString() };
}

/** The filters narrowed to one month: the comparison's month pickers replace the date range. */
async function monthCategories(input: ReportServiceInput, monthKey: string, timeZone: string): Promise<{ completeness: ReportCompleteness; rows: SpendingByCategoryRow[] }> {
  const { completeness, data } = await getSpendingByCategoryReport(monthFilters(input, monthKey, timeZone));
  return { completeness, rows: data };
}

function monthFilters(input: ReportServiceInput, monthKey: string, timeZone: string): ReportServiceInput {
  return { ...input, filters: { ...input.filters, ...monthRange(monthKey, timeZone) } };
}

async function monthTotals(input: ReportServiceInput, monthKey: string, timeZone: string): Promise<{ completeness: ReportCompleteness; totals: MonthComparisonTotals }> {
  const { completeness, data } = await getCashflowReport(monthFilters(input, monthKey, timeZone));
  // The range is exactly one month, so there is at most one row; an absent month is a measured zero.
  const row: CashflowRow | undefined = data.find((candidate) => candidate.month.slice(0, 7) === monthKey) ?? data[0];
  return {
    completeness,
    totals: {
      expenses: row?.expenses ?? 0,
      income: row?.income ?? 0,
      month: monthKey,
      net: row?.net ?? 0,
      savingsRate: row?.savingsRate ?? null,
    },
  };
}

/**
 * The rows each month's totals leave out, counted once per month: the cash-flow and
 * spending reports read the same rows, so the larger count is the month's, not their
 * sum. The two months hold different transactions, so their counts add.
 */
function mergeCompleteness(base: ReportCompleteness, compare: ReportCompleteness): ReportCompleteness {
  const unconvertedTransactions = base.unconvertedTransactions + compare.unconvertedTransactions;
  return {
    currencyCode: base.currencyCode,
    isComplete: unconvertedTransactions === 0,
    unconvertedCurrencies: [...new Set([...(base.unconvertedCurrencies ?? []), ...(compare.unconvertedCurrencies ?? [])])].sort(),
    unconvertedTransactions,
  };
}

function monthCompleteness(cashflow: ReportCompleteness, spending: ReportCompleteness): ReportCompleteness {
  return {
    currencyCode: cashflow.currencyCode,
    isComplete: cashflow.isComplete && spending.isComplete,
    unconvertedCurrencies: [...new Set([...(cashflow.unconvertedCurrencies ?? []), ...(spending.unconvertedCurrencies ?? [])])].sort(),
    unconvertedTransactions: Math.max(cashflow.unconvertedTransactions, spending.unconvertedTransactions),
  };
}

/**
 * Join the two months' category rows. A category present in only one month is still
 * compared, against zero: a new category is a rise and a vanished one a fall.
 */
export async function getMonthComparisonReport(input: ReportServiceInput, months: MonthComparisonMonths): Promise<ReportResult<MonthComparisonData>> {
  const timeZone = resolveReportTimeZone(input.filters.timezone);

  // Sequential rather than concurrent: both reports load the viewer's currency and exchange
  // rates through the request's EntityManager, and a report is not worth racing them for.
  const baseCashflow = await monthTotals(input, months.base, timeZone);
  const compareCashflow = await monthTotals(input, months.compare, timeZone);
  const baseSpending = await monthCategories(input, months.base, timeZone);
  const compareSpending = await monthCategories(input, months.compare, timeZone);

  return {
    completeness: mergeCompleteness(
      monthCompleteness(baseCashflow.completeness, baseSpending.completeness),
      monthCompleteness(compareCashflow.completeness, compareSpending.completeness),
    ),
    data: {
      base: baseCashflow.totals,
      categories: compareCategories(baseSpending.rows, compareSpending.rows),
      compare: compareCashflow.totals,
    },
  };
}

function compareCategories(baseRows: SpendingByCategoryRow[], compareRows: SpendingByCategoryRow[]): MonthComparisonCategoryRow[] {
  const baseByKey = new Map(baseRows.map((row) => [row.categoryKey, row]));
  const compareByKey = new Map(compareRows.map((row) => [row.categoryKey, row]));
  const keys = new Set([...baseByKey.keys(), ...compareByKey.keys()]);

  const rows: MonthComparisonCategoryRow[] = [];
  for (const categoryKey of keys) {
    const baseRow = baseByKey.get(categoryKey);
    const compareRow = compareByKey.get(categoryKey);
    const base = baseRow?.totalAmount ?? 0;
    const compare = compareRow?.totalAmount ?? 0;
    const delta = round2(base - compare);
    rows.push({
      base,
      categoryKey,
      color: baseRow?.color ?? compareRow?.color ?? '#000000',
      compare,
      delta,
      // A percentage of nothing is not a measurement: a category new this month has no baseline.
      deltaPct: compare === 0 ? null : round2((delta / compare) * 100),
      name: baseRow?.name ?? compareRow?.name ?? '',
    });
  }

  return rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.name.localeCompare(b.name) || a.categoryKey.localeCompare(b.categoryKey));
}

function stripBom(section: string): string {
  return section.replace(/^\uFEFF/, '');
}

/**
 * The CSV is the same rows the JSON response returns, in two labelled sections: the
 * month totals, then the category deltas. Follows the Sankey export's section style.
 */
export function buildMonthComparisonCsv(data: MonthComparisonData): string {
  const totals = `# totals\n${stripBom(
    toCsv(
      ['month', 'income', 'expenses', 'net', 'savingsRate'],
      [data.base, data.compare].map((row) => [
        row.month,
        row.income.toFixed(2),
        row.expenses.toFixed(2),
        row.net.toFixed(2),
        row.savingsRate === null ? '' : row.savingsRate.toFixed(2),
      ]),
    ),
  )}`;
  const categories = `# categories\n${stripBom(
    toCsv(
      ['categoryKey', 'name', 'color', 'base', 'compare', 'delta', 'deltaPct'],
      data.categories.map((row) => [
        row.categoryKey,
        row.name,
        row.color,
        row.base.toFixed(2),
        row.compare.toFixed(2),
        row.delta.toFixed(2),
        row.deltaPct === null ? '' : row.deltaPct.toFixed(2),
      ]),
    ),
  )}`;
  return `\uFEFF${totals}\n${categories}`;
}

/** The CSV export, rendered from the rows the JSON response returns. */
export async function getMonthComparisonCsv(input: ReportServiceInput, months: MonthComparisonMonths): Promise<string> {
  return buildMonthComparisonCsv((await getMonthComparisonReport(input, months)).data);
}
