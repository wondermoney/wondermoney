import { formatInTimeZone } from 'date-fns-tz';

import { classifyTransactions, createDiagnostics } from '@service/budget/aggregation-classifier';
import type { TenantAggregationRepository, TransactionAggregationRow } from '@service/budget/aggregation-types';
import { MikroOrmTenantAggregationRepository } from '@service/budget/tenant-aggregation.repository';
import { INSIGHTS } from '@service/insights/insights.constants';
import { compareSpendingToNormal, type SpendingComparison } from '@service/insights/insights.generators';
import type { SpendingBaselineMonth, SpendingVsNormalInput } from '@service/insights/insights.types';

import { round2 } from './csv';
import type { ReportCompleteness, ReportResult } from './report-currency';
import type { ReportServiceInput } from './report-filters';
import { monthRange, resolveReportTimeZone } from './report-months';

/**
 * Spending vs normal.
 *
 * The report answers one question — where this month's money went, and which categories are
 * running above or below their own normal — with the arithmetic the home insight already uses.
 * `compareSpendingToNormal` is #108's generator, not a copy: the three-month baseline, the
 * same-days-of-month cutoff, the refund netting and the floor at zero are the same code, so a
 * category's `total` and `normal` here are the `currentAmount` and `baselineAmount` on its
 * insight card for the same month.
 *
 * The rows are the top-level categories (the unit #108 reports) plus their subcategories, so the
 * table can break a parent down without inventing a second total. A subcategory is only included
 * when its parent has a positive total, since a parent whose refunds cancel its spend is not a
 * destination this month.
 *
 * The rows come through the aggregation repository the weekly and monthly emails use, so the
 * viewer's currency, the transfer and non-spending exclusions and the privacy rule are #108's.
 * The report filters it applies on top are the ones that are expressible on those rows: the
 * account filter and the category filter. `includePending`, `includeTransfers`, `merchantKeys`,
 * `tagKeys` and `currencyKey` are not applied: the insight's definition counts a pending row as
 * committed, never counts a transfer or a non-spending category, and values every row in the
 * viewer's currency. Applying them here would make the report disagree with the insight it
 * exists to explain.
 */

export interface SpendingVsNormalData {
  /** `YYYY-MM`. */
  month: string;
  rows: SpendingVsNormalRow[];
}

export interface SpendingVsNormalPeriod {
  /** The instant the month is read up to: now for the current month, its end for a past one. */
  asOf: Date;
  baselineMonths: BaselinePeriod[];
  daysElapsed: number;
  month: number;
  monthKey: string;
  range: Range;
  year: number;
}

export interface SpendingVsNormalRow {
  categoryKey: string;
  name: string;
  /** The top-level category this row breaks down; null for a top-level row. */
  parentKey: null | string;
  /** Spend this period, in the viewer's currency. */
  total: number;
  /** The three-month normal for the same days, or null when there is no usable baseline. */
  normal: null | number;
  /** `total / normal`; null when there is no usable baseline (shown neutral). */
  ratio: null | number;
}

interface BaselinePeriod extends Range {
  key: string;
  month: number;
  year: number;
}

interface Range {
  fromDate: string;
  toDate: string;
}

/**
 * The month the report is about and how much of it has elapsed, in the caller's calendar. A past
 * month is complete; the current month is read up to `now`; a future month has nothing to say.
 */
export function resolveSpendingVsNormalPeriod(monthKey: string, now: Date, timeZone: string): SpendingVsNormalPeriod {
  const range = monthRange(monthKey, timeZone);
  const start = new Date(range.fromDate);
  const end = new Date(new Date(range.toDate).getTime() + 1);
  const asOf = now < start ? start : now < end ? now : end;
  const daysInMonth = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const daysElapsed = asOf >= end ? daysInMonth : Number(formatInTimeZone(asOf, timeZone, 'd'));
  const [year, month] = monthKey.split('-').map(Number) as [number, number];

  return {
    asOf,
    baselineMonths: [1, 2, 3].map((monthsBack) => {
      const key = shiftMonthKey(monthKey, -monthsBack);
      const [baselineYear, baselineMonth] = key.split('-').map(Number) as [number, number];
      return { ...monthRange(key, timeZone), key, month: baselineMonth, year: baselineYear };
    }),
    daysElapsed,
    month,
    monthKey,
    range,
    year,
  };
}

/**
 * The report service: the month's rows, through the aggregation repository. Injectable so a test
 * can fix the clock and the repository.
 */
export class SpendingVsNormalReportService {
  constructor(
    private readonly repository: TenantAggregationRepository = new MikroOrmTenantAggregationRepository(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async getReport(input: ReportServiceInput, monthKey: string): Promise<ReportResult<SpendingVsNormalData>> {
    const { filters, tenant, user } = input;
    const timeZone = resolveReportTimeZone(filters.timezone);
    const period = resolveSpendingVsNormalPeriod(monthKey, this.clock(), timeZone);
    const empty = (unconvertedTransactions = 0): ReportResult<SpendingVsNormalData> => ({
      completeness: completeness(user.currencyKey.code, unconvertedTransactions),
      data: { month: monthKey, rows: [] },
    });

    if (!(await this.repository.hasActiveMembership(user.appuserKey, tenant.tenantKey))) return empty();

    const oldestBaseline = period.baselineMonths[period.baselineMonths.length - 1];
    if (!oldestBaseline) return empty();
    const rows = await this.repository.loadTransactions(user.appuserKey, tenant.tenantKey, {
      end: period.asOf,
      start: new Date(oldestBaseline.fromDate),
    });
    const diagnostics = createDiagnostics();
    const transactions = classifyTransactions(rows, user.appuserKey, tenant.tenantKey, diagnostics);

    const accountKeys = numberFilter(filters.accountKeys);
    const categoryKeys = numberFilter(filters.categoryKeys);
    const scoped = transactions.filter(
      (transaction) =>
        (accountKeys === undefined || accountKeys.includes(transaction.accountKey)) &&
        (categoryKeys === undefined || categoryKeys.includes(transaction.categoryKey)),
    );

    // #108 fires only with a complete baseline and a week of the month behind it; the report shows
    // the same rows neutral until then rather than comparing three days with three days.
    const baselineAvailable =
      period.daysElapsed >= INSIGHTS.MIN_DAYS_ELAPSED &&
      period.baselineMonths.every((baseline) => hasRows(rows, baseline));

    const baselineMonths: SpendingBaselineMonth[] = period.baselineMonths.map((baseline) => ({
      month: baseline.month,
      transactions: scoped.filter((transaction) => inRange(transaction.transactionDate, baseline)),
      year: baseline.year,
    }));
    const currentTransactions = scoped.filter(
      (transaction) => inRange(transaction.transactionDate, period.range) && transaction.transactionDate < period.asOf,
    );

    const comparisonInput: SpendingVsNormalInput = {
      baselineComplete: baselineAvailable,
      baselineMonths,
      currency: user.currencyKey.code,
      currentTransactions,
      daysElapsed: period.daysElapsed,
      fromDate: period.range.fromDate,
      month: period.month,
      timeZone,
      toDate: period.asOf.toISOString(),
      year: period.year,
    };

    const topLevel = compareSpendingToNormal(comparisonInput, 'top').filter((comparison) => comparison.currentAmount.gt(0));
    const includedParents = new Set(topLevel.map((comparison) => comparison.categoryKey));
    const subcategories = compareSpendingToNormal(comparisonInput, 'leaf').filter(
      (comparison) =>
        comparison.parentKey !== null && includedParents.has(comparison.parentKey) && comparison.currentAmount.gt(0),
    );

    const childrenByParent = new Map<number, SpendingComparison[]>();
    for (const comparison of subcategories) {
      if (comparison.parentKey === null) continue;
      const children = childrenByParent.get(comparison.parentKey) ?? [];
      children.push(comparison);
      childrenByParent.set(comparison.parentKey, children);
    }

    const ordered = topLevel
      .sort(byTotalDescending)
      .flatMap((top) => [top, ...(childrenByParent.get(top.categoryKey) ?? []).sort(byTotalDescending)]);

    return {
      completeness: completeness(user.currencyKey.code, diagnostics.missingConvertedAmounts),
      data: { month: monthKey, rows: ordered.map((comparison) => toRow(comparison, baselineAvailable)) },
    };
  }
}

/** `monthKey` moved by `delta` months (negative moves back). */
export function shiftMonthKey(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number) as [number, number];
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 15));
  return `${String(shifted.getUTCFullYear()).padStart(4, '0')}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The report for one month, through the request's EntityManager. */
export async function getSpendingVsNormalReport(
  input: ReportServiceInput,
  monthKey: string,
): Promise<ReportResult<SpendingVsNormalData>> {
  return new SpendingVsNormalReportService().getReport(input, monthKey);
}

function byTotalDescending(left: SpendingComparison, right: SpendingComparison): number {
  return right.currentAmount.cmp(left.currentAmount) || left.categoryKey - right.categoryKey;
}

function completeness(currencyCode: string, unconvertedTransactions: number): ReportCompleteness {
  return { currencyCode, isComplete: unconvertedTransactions === 0, unconvertedCurrencies: [], unconvertedTransactions };
}

function hasRows(rows: readonly TransactionAggregationRow[], range: Range): boolean {
  return rows.some((row) => row.transactionDate !== null && inRange(row.transactionDate, range));
}

function inRange(date: Date, range: Range): boolean {
  return date >= new Date(range.fromDate) && date <= new Date(range.toDate);
}

/** The filter's keys, or undefined when it selects nothing in particular. */
function numberFilter(keys: readonly string[] | undefined): number[] | undefined {
  if (!keys || keys.length === 0) return undefined;
  return keys.map(Number);
}

function toRow(comparison: SpendingComparison, baselineAvailable: boolean): SpendingVsNormalRow {
  const total = round2(Number(comparison.currentAmount));
  const normal =
    baselineAvailable && comparison.baselineAmount.gt(0) ? round2(Number(comparison.baselineAmount)) : null;
  // A normal below the insight's materiality floor cannot carry a percentage: a handful of euros
  // swings it by hundreds of percent, so the row is neutral, exactly as #108 suppresses it.
  const ratio =
    normal !== null && normal >= INSIGHTS.SPENDING_VS_NORMAL.MIN_BASELINE_AMOUNT
      ? Number((total / normal).toFixed(4))
      : null;

  return {
    categoryKey: String(comparison.categoryKey),
    name: comparison.name,
    normal,
    parentKey: comparison.parentKey === null ? null : String(comparison.parentKey),
    ratio,
    total,
  };
}
