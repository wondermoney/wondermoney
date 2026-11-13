import type {
  PortfolioPerformanceRow,
  ReportFilters,
} from "@/lib/api/reports/types";

export interface PortfolioPerformanceTotals {
  startValue: number | null;
  /** Null when any portfolio's is unknown, as for every total here: a partial sum would mislead. */
  netContributions: number | null;
  change: number | null;
  changePercent: number | null;
  dividends: number | null;
  endValue: number | null;
}

/** Sums in cents so a column of 2-decimal amounts adds up exactly. */
function sumCents(values: number[]): number {
  return values.reduce((sum, value) => sum + Math.round(value * 100), 0) / 100;
}

function sumKnown(values: (number | null)[]): number | null {
  return values.some((value) => value === null)
    ? null
    : sumCents(values as number[]);
}

/**
 * The household total across portfolios. The percentage is recomputed from the
 * totals (change over start plus contributions), never averaged across rows.
 */
export function totalPortfolioPerformance(
  rows: PortfolioPerformanceRow[],
): PortfolioPerformanceTotals {
  const startValue = sumKnown(rows.map((row) => row.startValue));
  const netContributions = sumKnown(rows.map((row) => row.netContributions));
  const change = sumKnown(rows.map((row) => row.change));
  const invested =
    startValue === null || netContributions === null
      ? null
      : sumCents([startValue, netContributions]);
  return {
    startValue,
    netContributions,
    change,
    changePercent:
      change !== null && invested !== null && invested > 0
        ? Math.round((change / invested) * 10_000) / 100
        : null,
    dividends: sumKnown(rows.map((row) => row.dividends)),
    endValue: sumKnown(rows.map((row) => row.endValue)),
  };
}

/** Biggest movers first, up or down; unknown changes last. */
export function sortByAbsoluteChangeDesc(
  a: PortfolioPerformanceRow,
  b: PortfolioPerformanceRow,
): number {
  return Math.abs(b.change ?? -1) - Math.abs(a.change ?? -1);
}

/**
 * The report covers every household portfolio over the period; the account,
 * category, merchant and transaction filters don't apply to it, so they are
 * not sent (and changing them does not refetch it). The member filter does: it
 * narrows the report to that member's portfolios.
 */
export function portfolioPerformanceFilters(
  filters: ReportFilters,
): ReportFilters {
  return {
    ...(filters.fromDate ? { fromDate: filters.fromDate } : {}),
    ...(filters.toDate ? { toDate: filters.toDate } : {}),
    ...(filters.timezone ? { timezone: filters.timezone } : {}),
    ...(filters.memberKeys?.length ? { memberKeys: filters.memberKeys } : {}),
  };
}
